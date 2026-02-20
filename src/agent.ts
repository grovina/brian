import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";
import path from "path";
import { config } from "./config.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { getToolDefinitions, getTool } from "./tools/index.js";
import { mcpManager } from "./mcp-client.js";
import { todayLogPath } from "./memory.js";

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const MAX_TURNS = 80;
const MAX_RETRIES = 3;
const MAX_HISTORY_MESSAGES = 100;
const STATE_DIR = path.join(process.env.HOME || "/home/brian", ".brian");
const STATE_FILE = path.join(STATE_DIR, "conversation-history.json");

type Message = Anthropic.MessageParam;

let conversationHistory: Message[] = [];

function sanitizeHistory(messages: Message[]): Message[] {
  // Trim leading messages until we find a user message with text content.
  // History truncation can orphan tool_result blocks whose matching
  // tool_use was in a now-trimmed assistant message.
  let start = 0;
  while (start < messages.length) {
    const msg = messages[start];
    if (msg.role !== "user") {
      start++;
      continue;
    }
    if (
      Array.isArray(msg.content) &&
      msg.content.some((b: any) => b.type === "tool_result")
    ) {
      start++;
      continue;
    }
    if (msg.content === "" || (Array.isArray(msg.content) && msg.content.length === 0)) {
      start++;
      continue;
    }
    break;
  }
  return messages.slice(start);
}

/** Strip base64 image data from history to keep the saved file small */
function stripImages(messages: Message[]): Message[] {
  return messages.map((msg) => {
    if (!Array.isArray(msg.content)) return msg;
    const stripped = msg.content.map((block: any) => {
      if (block.type === "image" && block.source?.type === "base64") {
        return { type: "text", text: "[image stripped from history]" };
      }
      // Also strip images inside tool_result content arrays
      if (block.type === "tool_result" && Array.isArray(block.content)) {
        return {
          ...block,
          content: block.content.map((b: any) =>
            b.type === "image" && b.source?.type === "base64"
              ? { type: "text", text: "[image stripped from history]" }
              : b
          ),
        };
      }
      return block;
    });
    return { ...msg, content: stripped };
  });
}

async function loadConversationState(): Promise<void> {
  try {
    await fs.mkdir(STATE_DIR, { recursive: true });
    const data = await fs.readFile(STATE_FILE, "utf-8");
    const state = JSON.parse(data);
    const trimmed = state.messages.slice(-MAX_HISTORY_MESSAGES);
    const clean = sanitizeHistory(trimmed);
    conversationHistory.push(...clean);
    console.log(`Restored ${clean.length} messages from history (${trimmed.length - clean.length} orphaned messages trimmed)`);
  } catch {
    console.log("Starting fresh conversation");
  }
}

async function saveConversationState(): Promise<void> {
  try {
    await fs.mkdir(STATE_DIR, { recursive: true });
    // Trim and strip images before saving to keep file small
    const toSave = stripImages(conversationHistory.slice(-MAX_HISTORY_MESSAGES));
    const clean = sanitizeHistory(toSave);
    await fs.writeFile(
      STATE_FILE,
      JSON.stringify(
        { messages: clean, lastActivity: Date.now() },
        null,
        2
      )
    );
  } catch (err) {
    console.error("Failed to save conversation state:", err);
  }
}

async function callLLM(
  systemPrompt: string,
  messages: Message[]
): Promise<Anthropic.Message> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const allTools = [
        ...getToolDefinitions(),
        ...mcpManager.getToolDefinitions(),
      ];

      return await client.messages.create({
        model: config.anthropic.model,
        max_tokens: 16384,
        system: systemPrompt,
        tools: allTools,
        messages,
      });
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_RETRIES - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<Anthropic.ToolResultBlockParam["content"]> {
  if (toolName.includes("__")) {
    return await mcpManager.executeTool(toolName, toolInput);
  }

  const tool = getTool(toolName);
  if (!tool) return `Unknown tool: ${toolName}`;
  try {
    return await tool.execute(toolInput);
  } catch (err) {
    return `Tool error: ${(err as Error).message}`;
  }
}

async function logStats(stats: {
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}): Promise<void> {
  const time = new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const duration = (stats.durationMs / 1000).toFixed(1);
  const line = `- [${time}] ${stats.tokensIn} in + ${stats.tokensOut} out tokens | ${stats.toolCalls} tools | ${duration}s\n`;

  const logPath = todayLogPath();
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, line);
}

loadConversationState().catch(console.error);

export async function runAgent(activityContext?: string): Promise<void> {
  const startTime = Date.now();
  const systemPrompt = await buildSystemPrompt();

  const now = new Date();
  const wake = now.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Trim any trailing user messages to maintain valid alternation
  while (
    conversationHistory.length > 0 &&
    conversationHistory[conversationHistory.length - 1].role === "user"
  ) {
    conversationHistory.pop();
  }

  const wakeMessage = activityContext
    ? `[${wake}]${activityContext}`
    : `[${wake}] No new activity — proactive wake.`;

  conversationHistory.push({ role: "user", content: wakeMessage });

  let toolCalls = 0;
  let tokensIn = 0;
  let tokensOut = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await callLLM(systemPrompt, conversationHistory);
    tokensIn += response.usage.input_tokens;
    tokensOut += response.usage.output_tokens;

    conversationHistory.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        toolCalls++;
        console.log(
          `[tool] ${toolUse.name}`,
          JSON.stringify(toolUse.input).slice(0, 200)
        );
        const result = await executeTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      conversationHistory.push({ role: "user", content: toolResults });
      continue;
    }

    break;
  }

  await saveConversationState();
  await logStats({
    toolCalls,
    tokensIn,
    tokensOut,
    durationMs: Date.now() - startTime,
  });
}

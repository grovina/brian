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
const MAX_HISTORY_MESSAGES = 200;
const STATE_DIR = path.join(process.env.HOME || "/home/brian", ".brian");
const STATE_FILE = path.join(STATE_DIR, "conversation-history.json");

type Message = Anthropic.MessageParam;

let conversationHistory: Message[] = [];

async function loadConversationState(): Promise<void> {
  try {
    await fs.mkdir(STATE_DIR, { recursive: true });
    const data = await fs.readFile(STATE_FILE, "utf-8");
    const state = JSON.parse(data);
    const recentMessages = state.messages.slice(-MAX_HISTORY_MESSAGES);
    conversationHistory.push(...recentMessages);
    console.log(`Restored ${recentMessages.length} messages from history`);
  } catch {
    console.log("Starting fresh conversation");
  }
}

async function saveConversationState(): Promise<void> {
  try {
    await fs.mkdir(STATE_DIR, { recursive: true });
    await fs.writeFile(
      STATE_FILE,
      JSON.stringify({ messages: conversationHistory, lastActivity: Date.now() }, null, 2)
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
      // Combine native tools with MCP tools
      const allTools = [...getToolDefinitions(), ...mcpManager.getToolDefinitions()];
      
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
): Promise<string> {
  // Check if it's an MCP tool (prefixed with server name)
  if (toolName.includes("__")) {
    return await mcpManager.executeTool(toolName, toolInput);
  }
  
  // Native tool
  const tool = getTool(toolName);
  if (!tool) return `Unknown tool: ${toolName}`;
  try {
    return await tool.execute(toolInput);
  } catch (err) {
    return `Tool error: ${(err as Error).message}`;
  }
}

export interface AgentResult {
  response: string;
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

export type MessageContent = string | Anthropic.MessageParam["content"];

async function logStats(stats: Omit<AgentResult, "response">): Promise<void> {
  const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const duration = (stats.durationMs / 1000).toFixed(1);
  const line = `- [${time}] ${stats.tokensIn} in + ${stats.tokensOut} out tokens | ${stats.toolCalls} tools | ${duration}s\n`;

  const logPath = todayLogPath();
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, line);
}

loadConversationState().catch(console.error);

export async function runAgent(userMessage: MessageContent): Promise<AgentResult> {
  const startTime = Date.now();
  const systemPrompt = await buildSystemPrompt();

  conversationHistory.push({ role: "user", content: userMessage });

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
        console.log(`[tool] ${toolUse.name}`, JSON.stringify(toolUse.input).slice(0, 200));
        const result = await executeTool(toolUse.name, toolUse.input as Record<string, unknown>);
        toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: result });
      }

      conversationHistory.push({ role: "user", content: toolResults });
      continue;
    }

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    const responseText = textBlocks.map((b) => b.text).join("\n");
    const stats = { toolCalls, tokensIn, tokensOut, durationMs: Date.now() - startTime };

    await saveConversationState();
    await logStats(stats);

    return { response: responseText, ...stats };
  }

  const stats = { toolCalls, tokensIn, tokensOut, durationMs: Date.now() - startTime };
  await saveConversationState();
  await logStats(stats);

  return { response: "Reached maximum number of turns.", ...stats };
}

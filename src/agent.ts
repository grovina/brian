import { GoogleGenAI, ThinkingLevel, type Content, type Part } from "@google/genai";
import fs from "fs/promises";
import path from "path";
import { config } from "./config.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { getToolDefinitions, getTool, type ToolDefinition, type ToolResult } from "./tools/index.js";
import { mcpManager } from "./mcp-client.js";
import { todayLogPath } from "./memory.js";

const ai = new GoogleGenAI({
  vertexai: true,
  project: config.llm.gcpProject,
  location: config.llm.gcpRegion,
});

const MAX_TURNS = 80;
const MAX_RETRIES = 3;
const MAX_HISTORY_MESSAGES = 100;
const STATE_DIR = path.join(process.env.HOME || "/home/brian", ".brian");
const STATE_FILE = path.join(STATE_DIR, "conversation-history.json");

let conversationHistory: Content[] = [];

function sanitizeHistory(messages: Content[]): Content[] {
  let start = 0;
  while (start < messages.length) {
    const msg = messages[start];
    if (msg.role !== "user") {
      start++;
      continue;
    }
    const hasFunctionResponse = msg.parts?.some(
      (p: any) => p.functionResponse
    );
    if (hasFunctionResponse) {
      start++;
      continue;
    }
    const hasText = msg.parts?.some((p: any) => p.text);
    if (!hasText) {
      start++;
      continue;
    }
    break;
  }
  return messages.slice(start);
}

function stripImages(messages: Content[]): Content[] {
  return messages.map((msg) => ({
    ...msg,
    parts: msg.parts?.map((part: any) => {
      if (part.inlineData) {
        return { text: "[image stripped from history]" };
      }
      return part;
    }),
  }));
}

async function loadConversationState(): Promise<void> {
  try {
    await fs.mkdir(STATE_DIR, { recursive: true });
    const data = await fs.readFile(STATE_FILE, "utf-8");
    const state = JSON.parse(data);
    const trimmed = (state.messages as Content[]).slice(-MAX_HISTORY_MESSAGES);
    const clean = sanitizeHistory(trimmed);
    conversationHistory.push(...clean);
    console.log(
      `Restored ${clean.length} messages from history (${trimmed.length - clean.length} orphaned messages trimmed)`
    );
  } catch {
    console.log("Starting fresh conversation");
  }
}

async function saveConversationState(): Promise<void> {
  try {
    await fs.mkdir(STATE_DIR, { recursive: true });
    const toSave = stripImages(
      conversationHistory.slice(-MAX_HISTORY_MESSAGES)
    );
    const clean = sanitizeHistory(toSave);
    await fs.writeFile(
      STATE_FILE,
      JSON.stringify({ messages: clean, lastActivity: Date.now() }, null, 2)
    );
  } catch (err) {
    console.error("Failed to save conversation state:", err);
  }
}

function toFunctionDeclarations(defs: ToolDefinition[]) {
  return defs.map((d) => ({
    name: d.name,
    description: d.description,
    parameters: d.parameters,
  }));
}

async function callLLM(systemPrompt: string, contents: Content[]) {
  const allDefs = [...getToolDefinitions(), ...mcpManager.getToolDefinitions()];

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await ai.models.generateContent({
        model: config.llm.model,
        contents,
        config: {
          systemInstruction: systemPrompt,
          tools: [{ functionDeclarations: toFunctionDeclarations(allDefs) }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
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
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  if (name.includes("__")) {
    return await mcpManager.executeTool(name, args);
  }
  const tool = getTool(name);
  if (!tool) return `Unknown tool: ${name}`;
  try {
    return await tool.execute(args);
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

  conversationHistory.push({
    role: "user",
    parts: [{ text: wakeMessage }],
  });

  let toolCalls = 0;
  let tokensIn = 0;
  let tokensOut = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await callLLM(systemPrompt, conversationHistory);
    tokensIn += response.usageMetadata?.promptTokenCount ?? 0;
    tokensOut += response.usageMetadata?.candidatesTokenCount ?? 0;

    const modelParts: Part[] =
      response.candidates?.[0]?.content?.parts ?? [];

    conversationHistory.push({
      role: "model",
      parts: modelParts,
    });

    const fnCalls = response.functionCalls;
    if (fnCalls && fnCalls.length > 0) {
      const responseParts: Part[] = [];

      for (const fc of fnCalls) {
        toolCalls++;
        console.log(
          `[tool] ${fc.name}`,
          JSON.stringify(fc.args).slice(0, 200)
        );

        const result = await executeTool(
          fc.name!,
          (fc.args as Record<string, unknown>) ?? {}
        );

        const textResult =
          typeof result === "string" ? result : result.text;

        responseParts.push({
          functionResponse: {
            name: fc.name!,
            response: { result: textResult },
          },
        });

        // If the tool returned images, include them as inline data
        if (typeof result !== "string" && result.images?.length) {
          for (const img of result.images) {
            responseParts.push({
              inlineData: { data: img.data, mimeType: img.mimeType },
            });
          }
        }
      }

      conversationHistory.push({
        role: "user",
        parts: responseParts,
      });
      continue;
    }

    // No function calls — model is done
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

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";
import path from "path";
import { config } from "./config.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { getToolDefinitions, getTool } from "./tools/index.js";

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const MAX_TURNS = 80;
const MAX_RETRIES = 3;
const STATE_DIR = path.join(process.env.HOME || "/home/brian", ".brian");
const STATE_FILE = path.join(STATE_DIR, "conversation-state.json");
const MAX_HISTORY_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

type Message = Anthropic.MessageParam;

interface ConversationState {
  messages: Message[];
  lastActivity: number;
}

const conversationHistory: Message[] = [];

async function loadConversationState(): Promise<void> {
  try {
    await fs.mkdir(STATE_DIR, { recursive: true });
    const data = await fs.readFile(STATE_FILE, "utf-8");
    const state: ConversationState = JSON.parse(data);
    
    // Check if state is too old
    const age = Date.now() - state.lastActivity;
    if (age > MAX_HISTORY_AGE_MS) {
      console.log("Conversation state expired, starting fresh");
      return;
    }
    
    conversationHistory.push(...state.messages);
    console.log(`Restored ${state.messages.length} messages from previous conversation`);
  } catch (err) {
    // File doesn't exist or can't be read - start fresh
    console.log("Starting fresh conversation");
  }
}

async function saveConversationState(): Promise<void> {
  try {
    await fs.mkdir(STATE_DIR, { recursive: true });
    const state: ConversationState = {
      messages: conversationHistory,
      lastActivity: Date.now(),
    };
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
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
      return await client.messages.create({
        model: config.anthropic.model,
        max_tokens: 16384,
        system: systemPrompt,
        tools: getToolDefinitions(),
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
  const tool = getTool(toolName);
  if (!tool) {
    return `Unknown tool: ${toolName}`;
  }
  try {
    return await tool.execute(toolInput);
  } catch (err) {
    return `Tool error: ${(err as Error).message}`;
  }
}

export interface AgentResult {
  response: string;
  toolCalls: number;
}

export type MessageContent = string | Anthropic.MessageParam["content"];

// Load state on module initialization
loadConversationState().catch(console.error);

export async function runAgent(userMessage: MessageContent): Promise<AgentResult> {
  const systemPrompt = await buildSystemPrompt();

  conversationHistory.push({
    role: "user",
    content: userMessage,
  });

  let toolCalls = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await callLLM(systemPrompt, conversationHistory);

    conversationHistory.push({
      role: "assistant",
      content: response.content,
    });

    if (response.stop_reason === "end_turn") {
      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === "text"
      );
      const responseText = textBlocks.map((b) => b.text).join("\n");
      await saveConversationState();
      return { response: responseText, toolCalls };
    }

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        toolCalls++;
        console.log(`[tool] ${toolUse.name}`, JSON.stringify(toolUse.input).slice(0, 200));
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

      conversationHistory.push({
        role: "user",
        content: toolResults,
      });

      continue;
    }

    // Unexpected stop reason — return what we have
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    await saveConversationState();
    return {
      response: textBlocks.map((b) => b.text).join("\n"),
      toolCalls,
    };
  }

  await saveConversationState();
  return {
    response: "Reached maximum number of turns. The task may be incomplete.",
    toolCalls,
  };
}

export async function clearConversation(): Promise<void> {
  conversationHistory.length = 0;
  try {
    await fs.unlink(STATE_FILE);
  } catch (err) {
    // File might not exist
  }
}

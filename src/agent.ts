import fs from "fs/promises";
import path from "path";
import type {
  ModelProvider,
  Message,
  Tool,
  ToolDefinition,
  ToolResult,
} from "./types.js";
import { buildSystemPrompt } from "./prompt.js";
import { MCPManager } from "./mcp.js";
import { Memory } from "./memory.js";

const MAX_TURNS = 80;
const MAX_RETRIES = 3;
const MAX_HISTORY_MESSAGES = 100;

interface AgentConfig {
  name: string;
  stateDir: string;
  model: ModelProvider;
  tools: Tool[];
  mcp: MCPManager;
  extraPromptSections?: string[];
}

function sanitizeHistory(messages: Message[]): Message[] {
  let start = 0;
  while (start < messages.length) {
    const msg = messages[start];
    if (msg.role !== "user") {
      start++;
      continue;
    }
    if (msg.toolResults) {
      start++;
      continue;
    }
    if (msg.text) break;
    start++;
  }
  return messages.slice(start);
}

function stripImages(messages: Message[]): Message[] {
  return messages.map((msg) => ({
    ...msg,
    images: undefined,
    toolResults: msg.toolResults?.map((tr) => ({ ...tr, images: undefined })),
  }));
}

export class Agent {
  private history: Message[] = [];
  private config: AgentConfig;
  private toolMap: Map<string, Tool>;
  private stateFile: string;

  constructor(config: AgentConfig) {
    this.config = config;
    this.toolMap = new Map(config.tools.map((t) => [t.name, t]));
    this.stateFile = path.join(config.stateDir, "conversation.json");
  }

  async init(): Promise<void> {
    await this.loadHistory();
  }

  async run(): Promise<void> {
    const startTime = Date.now();

    const systemPrompt = await buildSystemPrompt({
      name: this.config.name,
      stateDir: this.config.stateDir,
      extraSections: this.config.extraPromptSections,
    });

    const now = new Date();
    const wake = now.toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

    while (
      this.history.length > 0 &&
      this.history[this.history.length - 1].role === "user"
    ) {
      this.history.pop();
    }

    this.history.push({
      role: "user",
      text: `[${wake}]`,
    });

    const allToolDefs = this.getAllToolDefinitions();
    let toolCalls = 0;
    let tokensIn = 0;
    let tokensOut = 0;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await this.callWithRetry(systemPrompt, allToolDefs);
      tokensIn += response.usage?.inputTokens ?? 0;
      tokensOut += response.usage?.outputTokens ?? 0;

      this.history.push({
        role: "assistant",
        text: response.text,
        toolCalls: response.toolCalls,
        metadata: response.metadata,
      });

      if (response.toolCalls && response.toolCalls.length > 0) {
        const results = await this.executeToolCalls(response.toolCalls);
        toolCalls += response.toolCalls.length;

        this.history.push({
          role: "user",
          toolResults: results.map((r, i) => ({
            toolCallId: response.toolCalls![i].id,
            result: typeof r === "string" ? r : r.text,
            images: typeof r !== "string" ? r.images : undefined,
          })),
        });
        continue;
      }

      break;
    }

    await this.saveHistory();
    await this.logStats({
      toolCalls,
      tokensIn,
      tokensOut,
      durationMs: Date.now() - startTime,
    });
  }

  private getAllToolDefinitions(): ToolDefinition[] {
    const builtIn = this.config.tools.map((t) => t.definition);
    const mcp = this.config.mcp.getToolDefinitions();
    return [...builtIn, ...mcp];
  }

  private async callWithRetry(
    systemPrompt: string,
    tools: ToolDefinition[]
  ) {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.config.model.generate({
          systemPrompt,
          messages: this.history,
          tools,
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

  private async executeToolCalls(
    calls: { id: string; name: string; args: Record<string, unknown> }[]
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const call of calls) {
      console.log(
        `[tool] ${call.name}`,
        JSON.stringify(call.args).slice(0, 200)
      );

      try {
        if (this.config.mcp.isMCPTool(call.name)) {
          results.push(
            await this.config.mcp.executeTool(call.name, call.args)
          );
        } else {
          const tool = this.toolMap.get(call.name);
          if (!tool) {
            results.push(`Unknown tool: ${call.name}`);
          } else {
            results.push(await tool.execute(call.args));
          }
        }
      } catch (err) {
        results.push(`Tool error: ${(err as Error).message}`);
      }
    }

    return results;
  }

  private async loadHistory(): Promise<void> {
    try {
      await fs.mkdir(this.config.stateDir, { recursive: true });
      const data = await fs.readFile(this.stateFile, "utf-8");
      const state = JSON.parse(data);
      const trimmed = (state.messages as Message[]).slice(
        -MAX_HISTORY_MESSAGES
      );
      this.history = sanitizeHistory(trimmed);
      console.log(
        `Restored ${this.history.length} messages from conversation`
      );
    } catch {
      console.log("Starting fresh conversation");
    }
  }

  private async saveHistory(): Promise<void> {
    try {
      await fs.mkdir(this.config.stateDir, { recursive: true });
      const toSave = stripImages(
        this.history.slice(-MAX_HISTORY_MESSAGES)
      );
      const clean = sanitizeHistory(toSave);
      await fs.writeFile(
        this.stateFile,
        JSON.stringify({ messages: clean }, null, 2)
      );
    } catch (err) {
      console.error("Failed to save conversation state:", err);
    }
  }

  private async logStats(stats: {
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

    const memory = new Memory(this.config.stateDir);
    const logPath = memory.todayLogPath();
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, line);
  }
}

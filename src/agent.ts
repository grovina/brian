import fs from "fs/promises";
import path from "path";
import {
  formatTime,
  sanitizeHistory,
  type ModelProvider,
  type Message,
  type Tool,
  type ToolDefinition,
  type ToolResult,
} from "./types.js";
import { buildSystemPrompt } from "./prompt.js";
import { UpdateQueue, formatUpdates, collectImages } from "./updates.js";
import { TurnStore } from "./turns.js";

const MAX_RETRIES = 3;
const MAX_HISTORY_MESSAGES = 100;

interface AgentConfig {
  name: string;
  stateDir: string;
  model: ModelProvider;
  tools: Tool[];
  updates: UpdateQueue;
}

interface TurnInput {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
}

export class Agent {
  private history: Message[] = [];
  private config: AgentConfig;
  private toolMap: Map<string, Tool>;
  private turnStore: TurnStore;

  constructor(config: AgentConfig) {
    this.config = config;
    this.toolMap = new Map(config.tools.map((t) => [t.name, t]));
    this.turnStore = new TurnStore(config.stateDir);
  }

  async loop(): Promise<never> {
    await this.loadHistory();

    const toolDefs = this.config.tools.map((t) => t.definition);

    this.history.push({
      role: "user",
      text: `[${formatTime()}]`,
    });

    while (true) {
      const turnInput = await this.buildTurnInput(toolDefs);

      const startTime = Date.now();
      const response = await this.callWithRetry(turnInput);

      await this.turnStore.save({
        ts: new Date().toISOString(),
        provider: process.env.MODEL_PROVIDER ?? null,
        modelId: process.env.MODEL_ID ?? null,
        durationMs: Date.now() - startTime,
        input: turnInput,
        response,
      });

      const hasAssistantContent =
        Boolean(response.text) ||
        Boolean(response.toolCalls && response.toolCalls.length > 0) ||
        response.metadata !== undefined;

      if (hasAssistantContent) {
        this.history.push({
          role: "assistant",
          text: response.text,
          toolCalls: response.toolCalls,
          metadata: response.metadata,
        });
      }

      if (response.toolCalls && response.toolCalls.length > 0) {
        const results = await this.executeToolCalls(response.toolCalls);

        const pending = this.config.updates.drain();
        const updateText =
          pending.length > 0 ? formatUpdates(pending) : undefined;
        const updateImages = collectImages(pending);

        this.history.push({
          role: "user",
          toolResults: results.map((r, i) => ({
            toolCallId: response.toolCalls![i].id,
            result: typeof r === "string" ? r : r.text,
            images: typeof r !== "string" ? r.images : undefined,
          })),
          text: updateText,
          images: updateImages.length > 0 ? updateImages : undefined,
        });
      } else {
        const pending = this.config.updates.drain();
        this.history.push({
          role: "user",
          text:
            pending.length > 0 ? formatUpdates(pending) : `[${formatTime()}]`,
        });
      }

      this.trimHistory();
      await this.saveHistory();
    }
  }

  private async buildTurnInput(tools: ToolDefinition[]): Promise<TurnInput> {
    const systemPrompt = await buildSystemPrompt({
      name: this.config.name,
      stateDir: this.config.stateDir,
    });
    return {
      systemPrompt,
      messages: this.history,
      tools,
    };
  }

  private async callWithRetry(input: TurnInput) {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.config.model.generate({
          systemPrompt: input.systemPrompt,
          messages: input.messages,
          tools: input.tools,
        });
      } catch (err) {
        lastError = err as Error;
        console.error(
          `[agent] model error (attempt ${attempt + 1}):`,
          lastError.message
        );
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
        const tool = this.toolMap.get(call.name);
        if (!tool) {
          results.push(`Unknown tool: ${call.name}`);
        } else {
          results.push(await tool.execute(call.args));
        }
      } catch (err) {
        results.push(`Tool error: ${(err as Error).message}`);
      }
    }

    return results;
  }

  private async loadHistory(): Promise<void> {
    try {
      const raw = await fs.readFile(
        path.join(this.config.stateDir, "history.json"),
        "utf-8"
      );
      this.history = sanitizeHistory(JSON.parse(raw) as Message[]);
      console.log(`Restored ${this.history.length} messages from history`);
    } catch {
      console.log("Starting fresh conversation");
    }
  }

  private async saveHistory(): Promise<void> {
    await fs.writeFile(
      path.join(this.config.stateDir, "history.json"),
      JSON.stringify(this.history)
    );
  }

  private trimHistory(): void {
    if (this.history.length <= MAX_HISTORY_MESSAGES) return;

    const dropped = this.history.length - MAX_HISTORY_MESSAGES;
    this.history = sanitizeHistory(
      this.history.slice(-MAX_HISTORY_MESSAGES)
    );

    this.history.unshift({
      role: "user",
      text: `[Context compacted at ${formatTime()} — ${dropped} older messages were dropped. Long-term knowledge is in memory.md.]`,
    });
  }
}

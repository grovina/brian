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
import { UpdateQueue, formatUpdates, collectImages } from "./updates.js";
import { Memory } from "./memory.js";
import { SignalStore, formatSignalSection } from "./signals.js";
import { TurnStore } from "./turns.js";

const MAX_TURNS_PER_CYCLE = 200;
const MAX_RETRIES = 3;
const MAX_HISTORY_MESSAGES = 100;

interface AgentConfig {
  name: string;
  stateDir: string;
  model: ModelProvider;
  tools: Tool[];
  updates: UpdateQueue;
  extraPromptSections?: string[];
}

interface TurnInput {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  signalSection: string | null;
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

function currentTime(): string {
  return new Date().toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export class Agent {
  private history: Message[] = [];
  private config: AgentConfig;
  private toolMap: Map<string, Tool>;
  private signalStore: SignalStore;
  private turnStore: TurnStore;
  private turnSeq = 0;

  constructor(config: AgentConfig) {
    this.config = config;
    this.toolMap = new Map(config.tools.map((t) => [t.name, t]));
    this.signalStore = new SignalStore(config.stateDir);
    this.turnStore = new TurnStore(config.stateDir);
  }

  async loop(): Promise<never> {
    await this.loadHistory();

    const toolDefs = this.config.tools.map((t) => t.definition);
    let turnsSinceWait = 0;

    this.history.push({
      role: "user",
      text: `[${currentTime()}]`,
    });

    while (true) {
      const turnInput = await this.buildTurnInput(toolDefs);
      const turnId = ++this.turnSeq;
      await this.turnStore.appendRequest({
        turnId,
        provider: process.env.MODEL_PROVIDER ?? null,
        modelId: process.env.MODEL_ID ?? null,
        input: turnInput,
      });

      const startTime = Date.now();
      const response = await this.callWithRetry(turnInput);
      await this.turnStore.appendResponse({
        turnId,
        response,
      });
      const metadata =
        Array.isArray(response.metadata) && response.metadata.length === 0
          ? undefined
          : response.metadata;
      const hasAssistantContent =
        Boolean(response.text) ||
        Boolean(response.toolCalls && response.toolCalls.length > 0) ||
        metadata !== undefined;

      if (hasAssistantContent) {
        this.history.push({
          role: "assistant",
          text: response.text,
          toolCalls: response.toolCalls,
          metadata,
        });
      }

      if (response.toolCalls && response.toolCalls.length > 0) {
        const results = await this.executeToolCalls(response.toolCalls);
        turnsSinceWait++;

        // --- Control point ---
        const pending = this.config.updates.drain();
        const updateText = pending.length > 0 ? formatUpdates(pending) : undefined;
        const updateImages = collectImages(pending);
        for (const update of pending) {
          await this.signalStore.append(update.content, update.timestamp);
        }

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
        // Model produced text without tool calls — inject updates or time marker
        const pending = this.config.updates.drain();
        for (const update of pending) {
          await this.signalStore.append(update.content, update.timestamp);
        }
        this.history.push({
          role: "user",
          text: pending.length > 0 ? formatUpdates(pending) : `[${currentTime()}]`,
        });
        turnsSinceWait = 0;
      }

      this.trimHistory();

      await this.logStats({
        tokensIn: response.usage?.inputTokens ?? 0,
        tokensOut: response.usage?.outputTokens ?? 0,
        durationMs: Date.now() - startTime,
      });

      if (turnsSinceWait >= MAX_TURNS_PER_CYCLE) {
        turnsSinceWait = 0;
      }
    }
  }

  private async buildTurnInput(tools: ToolDefinition[]): Promise<TurnInput> {
    const signalSection = formatSignalSection(
      await this.signalStore.readRecent(12)
    );
    const systemPrompt = await buildSystemPrompt({
      name: this.config.name,
      stateDir: this.config.stateDir,
      extraSections: [
        ...(this.config.extraPromptSections ?? []),
        ...(signalSection ? [signalSection] : []),
      ],
    });
    return {
      systemPrompt,
      messages: this.history,
      tools,
      signalSection,
    };
  }

  private async callWithRetry(
    input: TurnInput
  ) {
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
        console.error(`[agent] model error (attempt ${attempt + 1}):`, lastError.message);
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
      const restored = await this.turnStore.restoreRecentMessages(
        MAX_HISTORY_MESSAGES
      );
      this.history = restored.messages;
      this.turnSeq = restored.maxTurnId;
      console.log(
        `Restored ${this.history.length} messages from turns`
      );
    } catch {
      console.log("Starting fresh conversation");
    }
  }

  private trimHistory(): void {
    if (this.history.length > MAX_HISTORY_MESSAGES) {
      this.history = sanitizeHistory(
        this.history.slice(-MAX_HISTORY_MESSAGES)
      );
    }
  }

  private async logStats(stats: {
    tokensIn: number;
    tokensOut: number;
    durationMs: number;
  }): Promise<void> {
    const time = new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const duration = (stats.durationMs / 1000).toFixed(1);
    const line = `- [${time}] ${stats.tokensIn} in + ${stats.tokensOut} out tokens | ${duration}s\n`;

    const memory = new Memory(this.config.stateDir);
    const logPath = memory.todayLogPath();
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, line);
  }
}

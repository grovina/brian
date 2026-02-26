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
import { clip, formatArgs, formatErrorMessage, formatToolResult, oneLine } from "./logs.js";

const MAX_RETRIES = 3;
const MAX_HISTORY_MESSAGES = 100;
const MAX_TURN_INPUT_CHARS = 320_000;
const MAX_MESSAGE_TEXT_CHARS = 32_000;
const MAX_TOOL_RESULT_CHARS = 16_000;
const MIN_MESSAGES_AFTER_COMPACTION = 20;

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

type TruncateKeep = "start" | "end";

function truncateText(
  text: string,
  maxChars: number,
  keep: TruncateKeep
): string {
  if (text.length <= maxChars) return text;
  const notice =
    keep === "end"
      ? `[content truncated before this point; kept latest ${maxChars} chars]\n`
      : `[content truncated after this point; kept first ${maxChars} chars]\n`;
  const keptChars = Math.max(0, maxChars - notice.length);
  if (keep === "end") {
    return notice + text.slice(-keptChars);
  }
  return notice + text.slice(0, keptChars);
}

function estimateInputChars(input: TurnInput): number {
  let total = input.systemPrompt.length;
  for (const msg of input.messages) {
    total += msg.text?.length ?? 0;
    if (msg.toolCalls) {
      for (const call of msg.toolCalls) {
        total += call.name.length;
        try {
          total += JSON.stringify(call.args).length;
        } catch {
          total += 100;
        }
      }
    }
    if (msg.toolResults) {
      for (const result of msg.toolResults) {
        total += result.result.length;
      }
    }
  }
  return total;
}

export class Agent {
  private history: Message[] = [];
  private config: AgentConfig;
  private toolMap: Map<string, Tool>;
  private turnStore: TurnStore;
  private turnSeq = 0;

  constructor(config: AgentConfig) {
    this.config = config;
    this.toolMap = new Map(config.tools.map((t) => [t.name, t]));
    this.turnStore = new TurnStore(config.stateDir);
  }

  async loop(): Promise<never> {
    await this.loadHistory();

    const toolDefs = this.config.tools.map((t) => t.definition);

    const startupUpdates = this.config.updates.drain();
    const startupText = `[Agent started at ${formatTime()} — first turn after startup]`;
    this.history.push({
      role: "user",
      text:
        startupUpdates.length > 0
          ? `${startupText}\n\n${formatUpdates(startupUpdates)}`
          : startupText,
      images:
        startupUpdates.length > 0
          ? collectImages(startupUpdates)
          : undefined,
    });

    while (true) {
      const turnId = ++this.turnSeq;
      const turnInput = await this.buildTurnInput(toolDefs);

      const startTime = Date.now();
      const response = await this.callWithRetry(turnInput, turnId);
      const durationMs = Date.now() - startTime;

      const requestedTools = response.toolCalls?.length ?? 0;
      console.log(`[turn ${turnId}] model done ${durationMs}ms (tools: ${requestedTools})`);

      await this.turnStore.save({
        ts: new Date().toISOString(),
        provider: process.env.MODEL_PROVIDER ?? null,
        modelId: process.env.MODEL_ID ?? null,
        durationMs,
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
        const results = await this.executeToolCalls(response.toolCalls, turnId);

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
    return this.maybeTruncateInput({
      systemPrompt,
      messages: this.history,
      tools,
    });
  }

  private async callWithRetry(input: TurnInput, turnId: number) {
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
        if (attempt < MAX_RETRIES - 1) {
          console.error(
            `[turn ${turnId}] model error attempt ${attempt + 1}/${MAX_RETRIES}: ${clip(formatErrorMessage(lastError))} (retrying)`
          );
        } else {
          console.error(
            `[turn ${turnId}] model error attempt ${attempt + 1}/${MAX_RETRIES}: ${clip(formatErrorMessage(lastError))} (giving up)`
          );
        }
        if (attempt < MAX_RETRIES - 1) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastError;
  }

  private async executeToolCalls(
    calls: { id: string; name: string; args: Record<string, unknown> }[],
    turnId: number
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const [index, call] of calls.entries()) {
      const toolId = index + 1;
      const prefix = `[turn ${turnId}] [tool ${toolId}] ${call.name}`;
      console.log(`${prefix} ${formatArgs(call.args)}`);
      const startedAt = Date.now();

      try {
        const tool = this.toolMap.get(call.name);
        if (!tool) {
          const msg = `Unknown tool: ${call.name}`;
          results.push(msg);
          const elapsedMs = Date.now() - startedAt;
          console.log(
            `${prefix} done in ${elapsedMs}ms with ERROR: ${clip(oneLine(msg))}`
          );
        } else {
          const result = await tool.execute(call.args);
          results.push(result);
          const elapsedMs = Date.now() - startedAt;
          console.log(
            `${prefix} done in ${elapsedMs}ms: ${formatToolResult(result)}`
          );
        }
      } catch (err) {
        const msg = `Tool error: ${formatErrorMessage(err)}`;
        results.push(msg);
        const elapsedMs = Date.now() - startedAt;
        console.log(
          `${prefix} done in ${elapsedMs}ms with ERROR: ${clip(oneLine(msg))}`
        );
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
      console.log(`history restored (${this.history.length} messages)`);
    } catch {
      console.log("history is empty; starting fresh conversation");
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

  private maybeTruncateInput(input: TurnInput): TurnInput {
    let messages = input.messages.map((msg) => ({
      ...msg,
      text: msg.text
        ? truncateText(msg.text, MAX_MESSAGE_TEXT_CHARS, "end")
        : undefined,
      toolResults: msg.toolResults?.map((result) => ({
        ...result,
        result: truncateText(result.result, MAX_TOOL_RESULT_CHARS, "end"),
      })),
    }));

    const compacted: TurnInput = {
      ...input,
      messages,
    };

    let dropped = 0;
    while (
      estimateInputChars(compacted) > MAX_TURN_INPUT_CHARS &&
      compacted.messages.length > MIN_MESSAGES_AFTER_COMPACTION
    ) {
      compacted.messages.shift();
      dropped++;
    }

    if (dropped > 0) {
      compacted.messages = sanitizeHistory(compacted.messages);
      compacted.messages.unshift({
        role: "user",
        text: `[Context compacted before model call at ${formatTime()} — ${dropped} older messages were dropped due to input size.]`,
      });
      console.log(`input compacted before model call (${dropped} messages dropped)`);
    }

    return compacted;
  }
}

import fs from "fs/promises";
import path from "path";
import type { Message, ToolDefinition } from "./types.js";

export interface TurnInputSnapshot {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  signalSection: string | null;
}

export interface TurnStoreRequestEntry {
  ts: string;
  kind: "request";
  turnId: number;
  provider: string | null;
  modelId: string | null;
  input: TurnInputSnapshot;
}

export interface TurnStoreResponseEntry {
  ts: string;
  kind: "response";
  turnId: number;
  response: unknown;
}

type TurnStoreEntry = TurnStoreRequestEntry | TurnStoreResponseEntry;

function snapshotReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
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

export class TurnStore {
  private filePath: string;

  constructor(stateDir: string) {
    this.filePath = path.join(stateDir, "turns.jsonl");
  }

  async appendRequest(input: {
    turnId: number;
    provider: string | null;
    modelId: string | null;
    input: TurnInputSnapshot;
  }): Promise<void> {
    await this.append({
      ts: new Date().toISOString(),
      kind: "request",
      turnId: input.turnId,
      provider: input.provider,
      modelId: input.modelId,
      input: input.input,
    });
  }

  async appendResponse(input: {
    turnId: number;
    response: unknown;
  }): Promise<void> {
    await this.append({
      ts: new Date().toISOString(),
      kind: "response",
      turnId: input.turnId,
      response: input.response,
    });
  }

  async restoreRecentMessages(limit: number): Promise<{
    messages: Message[];
    maxTurnId: number;
  }> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const lines = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      let restored: Message[] = [];
      let maxTurnId = 0;
      for (let i = lines.length - 1; i >= 0; i--) {
        let parsed: Partial<TurnStoreEntry>;
        try {
          parsed = JSON.parse(lines[i]) as Partial<TurnStoreEntry>;
        } catch {
          continue;
        }

        if (typeof parsed.turnId === "number") {
          maxTurnId = Math.max(maxTurnId, parsed.turnId);
        }
        if (parsed.kind !== "request") continue;
        const input = parsed.input;
        if (!input || !Array.isArray(input.messages)) continue;
        restored = sanitizeHistory(input.messages as Message[]).slice(-limit);
        break;
      }

      return {
        messages: restored,
        maxTurnId,
      };
    } catch {
      return {
        messages: [],
        maxTurnId: 0,
      };
    }
  }

  private async append(entry: TurnStoreEntry): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const line = JSON.stringify(entry, snapshotReplacer);
    await fs.appendFile(this.filePath, line + "\n", "utf-8");
  }
}


import fs from "fs/promises";
import path from "path";
import type { Message } from "./types.js";

function sanitizeMessages(messages: Message[]): Message[] {
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

interface MessageLine {
  ts: string;
  message: Message;
}

export class MessageStore {
  private filePath: string;

  constructor(stateDir: string) {
    this.filePath = path.join(stateDir, "messages.jsonl");
  }

  async loadRecent(limit = 100): Promise<Message[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const lines = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-limit);

      const messages: Message[] = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as MessageLine;
          if (!parsed?.message) continue;
          messages.push(parsed.message);
        } catch {
          // Skip malformed lines.
        }
      }

      return sanitizeMessages(messages);
    } catch {
      return [];
    }
  }

  async appendMany(messages: Message[], ts?: Date): Promise<void> {
    if (messages.length === 0) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const baseTs = (ts ?? new Date()).toISOString();
    const payload = stripImages(messages)
      .map((message) =>
        JSON.stringify({
          ts: baseTs,
          message,
        } satisfies MessageLine)
      )
      .join("\n");
    await fs.appendFile(this.filePath, payload + "\n", "utf-8");
  }
}


import fs from "fs/promises";
import path from "path";

export interface SignalLine {
  ts: string;
  text: string;
}

export class SignalStore {
  private filePath: string;

  constructor(stateDir: string) {
    this.filePath = path.join(stateDir, "signals.jsonl");
  }

  async append(text: string, ts?: Date): Promise<void> {
    const line: SignalLine = {
      ts: (ts ?? new Date()).toISOString(),
      text,
    };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, JSON.stringify(line) + "\n", "utf-8");
  }

  async readRecent(limit = 12): Promise<SignalLine[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const lines = raw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(-limit);

      const parsed: SignalLine[] = [];
      for (const line of lines) {
        try {
          const data = JSON.parse(line) as SignalLine;
          if (data.ts && data.text) parsed.push(data);
        } catch {
          // Skip malformed lines.
        }
      }
      return parsed;
    } catch {
      return [];
    }
  }
}

export function formatSignalSection(lines: SignalLine[]): string | null {
  if (lines.length === 0) return null;
  const bullets = lines.map((line) => `- [${line.ts}] ${line.text}`).join("\n");
  return `## Operational Signals\n\n${bullets}`;
}


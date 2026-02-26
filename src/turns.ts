import fs from "fs/promises";
import path from "path";
import type { Message, ToolDefinition, ModelResponse } from "./types.js";

export interface TurnSnapshot {
  ts: string;
  provider: string | null;
  modelId: string | null;
  durationMs: number;
  input: {
    systemPrompt: string;
    messages: Message[];
    tools: ToolDefinition[];
  };
  response: ModelResponse;
}

function snapshotReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

export class TurnStore {
  private dir: string;

  constructor(stateDir: string) {
    this.dir = path.join(stateDir, "turns");
  }

  async save(snapshot: TurnSnapshot): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const filename =
      snapshot.ts.replace(/:/g, "-").replace(/\./g, "-") + ".json";
    await fs.writeFile(
      path.join(this.dir, filename),
      JSON.stringify(snapshot, snapshotReplacer, 2)
    );
  }
}

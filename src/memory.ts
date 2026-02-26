import fs from "fs/promises";
import path from "path";

export class Memory {
  constructor(private stateDir: string) {}

  async readMemory(): Promise<string> {
    try {
      return await fs.readFile(path.join(this.stateDir, "memory.md"), "utf-8");
    } catch {
      return "";
    }
  }

  todayLogPath(): string {
    const date = new Date().toISOString().split("T")[0];
    return path.join(this.stateDir, "logs", `${date}.md`);
  }
}

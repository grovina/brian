import fs from "fs/promises";
import path from "path";

export class Memory {
  constructor(private stateDir: string) {}

  async readMemory(): Promise<string> {
    try {
      return await fs.readFile(path.join(this.stateDir, "MEMORY.md"), "utf-8");
    } catch {
      return "";
    }
  }

  async readHeartbeat(): Promise<string> {
    try {
      return await fs.readFile(
        path.join(this.stateDir, "HEARTBEAT.md"),
        "utf-8"
      );
    } catch {
      return "";
    }
  }

  async readRecentDailyLogs(days: number = 3): Promise<string> {
    const memoryDir = path.join(this.stateDir, "memory");
    try {
      const files = await fs.readdir(memoryDir);
      const mdFiles = files.filter((f) => f.endsWith(".md")).sort().reverse();
      const recent = mdFiles.slice(0, days);

      const logs: string[] = [];
      for (const file of recent) {
        const content = await fs.readFile(
          path.join(memoryDir, file),
          "utf-8"
        );
        logs.push(`## ${file}\n${content}`);
      }
      return logs.join("\n\n");
    } catch {
      return "";
    }
  }

  todayLogPath(): string {
    const date = new Date().toISOString().split("T")[0];
    return path.join(this.stateDir, "memory", `${date}.md`);
  }
}

import fs from "fs/promises";
import path from "path";
import { config } from "./config.js";

const workspacePath = config.paths.workspace;

export async function readMemory(): Promise<string> {
  try {
    return await fs.readFile(path.join(workspacePath, "MEMORY.md"), "utf-8");
  } catch {
    return "";
  }
}

export async function readHeartbeat(): Promise<string> {
  try {
    return await fs.readFile(
      path.join(workspacePath, "HEARTBEAT.md"),
      "utf-8"
    );
  } catch {
    return "";
  }
}

export async function readRecentDailyLogs(days: number = 3): Promise<string> {
  const memoryDir = path.join(workspacePath, "memory");
  try {
    const files = await fs.readdir(memoryDir);
    const mdFiles = files.filter((f) => f.endsWith(".md")).sort().reverse();
    const recent = mdFiles.slice(0, days);

    const logs: string[] = [];
    for (const file of recent) {
      const content = await fs.readFile(path.join(memoryDir, file), "utf-8");
      logs.push(`## ${file}\n${content}`);
    }
    return logs.join("\n\n");
  } catch {
    return "";
  }
}

export function todayLogPath(): string {
  const date = new Date().toISOString().split("T")[0];
  return path.join(workspacePath, "memory", `${date}.md`);
}

import fs from "fs/promises";
import path from "path";
import type { Tool } from "./types.js";

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

export function memoryTools(stateDir: string): Tool[] {
  return [
    {
      name: "memory_read",
      definition: {
        name: "memory_read",
        description:
          "Read a memory file. Use 'MEMORY.md' for long-term knowledge, 'HEARTBEAT.md' for the heartbeat checklist, or 'memory/YYYY-MM-DD.md' for daily logs.",
        parameters: {
          type: "object",
          properties: {
            file: {
              type: "string",
              description:
                "Relative path within the workspace (e.g. 'MEMORY.md', 'memory/2025-01-15.md')",
            },
          },
          required: ["file"],
        },
      },
      async execute(input) {
        const { file } = input as { file: string };
        const fullPath = path.join(stateDir, file);
        try {
          return await fs.readFile(fullPath, "utf-8");
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT")
            return `Memory file not found: ${file}`;
          throw err;
        }
      },
    },
    {
      name: "memory_write",
      definition: {
        name: "memory_write",
        description:
          "Write or append to a memory file. For daily logs, append new entries. For MEMORY.md, update the full content to keep it organized.",
        parameters: {
          type: "object",
          properties: {
            file: {
              type: "string",
              description:
                "Relative path within the workspace (e.g. 'MEMORY.md', 'memory/2025-01-15.md')",
            },
            content: {
              type: "string",
              description: "Content to write",
            },
            append: {
              type: "boolean",
              description: "If true, append instead of overwriting",
            },
          },
          required: ["file", "content"],
        },
      },
      async execute(input) {
        const { file, content, append } = input as {
          file: string;
          content: string;
          append?: boolean;
        };
        const fullPath = path.join(stateDir, file);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        if (append) {
          await fs.appendFile(fullPath, "\n" + content, "utf-8");
        } else {
          await fs.writeFile(fullPath, content, "utf-8");
        }
        return `${append ? "Appended to" : "Wrote"} ${file}`;
      },
    },
    {
      name: "memory_search",
      definition: {
        name: "memory_search",
        description: "Search memory files by keyword.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Keyword or phrase to search for",
            },
          },
          required: ["query"],
        },
      },
      async execute(input) {
        const { query } = input as { query: string };
        const results: string[] = [];
        const queryLower = query.toLowerCase();

        async function searchDir(dir: string) {
          let entries;
          try {
            entries = await fs.readdir(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              await searchDir(fullPath);
            } else if (entry.name.endsWith(".md")) {
              const content = await fs.readFile(fullPath, "utf-8");
              if (content.toLowerCase().includes(queryLower)) {
                const relativePath = path.relative(stateDir, fullPath);
                const lines = content.split("\n");
                const matches = lines
                  .filter((line) => line.toLowerCase().includes(queryLower))
                  .slice(0, 5);
                results.push(
                  `## ${relativePath}\n${matches.map((m) => `> ${m}`).join("\n")}`
                );
              }
            }
          }
        }

        await searchDir(stateDir);
        return results.length > 0
          ? results.join("\n\n")
          : `No results found for "${query}"`;
      },
    },
  ];
}

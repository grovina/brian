import fs from "fs/promises";
import path from "path";
import type { Tool } from "./types.js";

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

export function memoryTools(stateDir: string): Tool[] {
  return [
    {
      name: "memory_read",
      definition: {
        name: "memory_read",
        description:
          "Read a file from the state directory. Use 'memory.md' for long-term knowledge, or 'logs/YYYY-MM-DD.md' for daily activity logs.",
        parameters: {
          type: "object",
          properties: {
            file: {
              type: "string",
              description:
                "Relative path within the state directory (e.g. 'memory.md', 'logs/2025-01-15.md')",
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
            return `File not found: ${file}`;
          throw err;
        }
      },
    },
    {
      name: "memory_write",
      definition: {
        name: "memory_write",
        description:
          "Write to a file in the state directory. For memory.md, replace the full content to keep it organized. For logs, append entries.",
        parameters: {
          type: "object",
          properties: {
            file: {
              type: "string",
              description:
                "Relative path within the state directory (e.g. 'memory.md', 'logs/2025-01-15.md')",
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
        description: "Search files in the state directory by keyword.",
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

import fs from "fs/promises";
import path from "path";
import { config } from "../config.js";
import type { Tool } from "./index.js";

const workspacePath = config.paths.workspace;

export const memoryReadTool: Tool = {
  name: "memory_read",
  definition: {
    name: "memory_read",
    description:
      "Read a memory file from the workspace. Use 'MEMORY.md' for long-term knowledge, 'HEARTBEAT.md' for the heartbeat checklist, or 'memory/YYYY-MM-DD.md' for daily logs.",
    input_schema: {
      type: "object" as const,
      properties: {
        file: {
          type: "string",
          description: "Relative path within the workspace (e.g. 'MEMORY.md', 'memory/2025-01-15.md')",
        },
      },
      required: ["file"],
    },
  },
  async execute(input) {
    const { file } = input as { file: string };
    const fullPath = path.join(workspacePath, file);
    try {
      return await fs.readFile(fullPath, "utf-8");
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return `Memory file not found: ${file}`;
      throw err;
    }
  },
};

export const memoryWriteTool: Tool = {
  name: "memory_write",
  definition: {
    name: "memory_write",
    description:
      "Write or append to a memory file in the workspace. For daily logs, append new entries. For MEMORY.md, update the full content to keep it organized.",
    input_schema: {
      type: "object" as const,
      properties: {
        file: {
          type: "string",
          description: "Relative path within the workspace (e.g. 'MEMORY.md', 'memory/2025-01-15.md')",
        },
        content: {
          type: "string",
          description: "Content to write",
        },
        append: {
          type: "boolean",
          description: "If true, append to the file instead of overwriting. Defaults to false.",
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
    const fullPath = path.join(workspacePath, file);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    if (append) {
      await fs.appendFile(fullPath, "\n" + content, "utf-8");
    } else {
      await fs.writeFile(fullPath, content, "utf-8");
    }
    return `${append ? "Appended to" : "Wrote"} ${file}`;
  },
};

export const memorySearchTool: Tool = {
  name: "memory_search",
  definition: {
    name: "memory_search",
    description:
      "Search memory files by keyword. Searches across MEMORY.md and daily log files.",
    input_schema: {
      type: "object" as const,
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
            const relativePath = path.relative(workspacePath, fullPath);
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

    await searchDir(workspacePath);
    return results.length > 0
      ? results.join("\n\n")
      : `No results found for "${query}"`;
  },
};

import fs from "fs/promises";
import path from "path";
import type { Tool } from "./index.js";

const LOG_DIR = path.join(process.env.HOME || "/home/brian", ".brian", "logs");

export const logsTool: Tool = {
  name: "read_logs",
  definition: {
    name: "read_logs",
    description:
      "Read your own process logs. Use this to debug issues, see errors, check what messages were received, etc. Critical for closing feedback loops.",
    input_schema: {
      type: "object" as const,
      properties: {
        lines: {
          type: "number",
          description: "Number of recent lines to read. Defaults to 100.",
        },
        filter: {
          type: "string",
          description: "Optional grep filter to search for specific content (e.g., 'ERROR', 'Image', 'photo')",
        },
      },
      required: [],
    },
  },
  async execute(input) {
    const { lines = 100, filter } = input as {
      lines?: number;
      filter?: string;
    };

    try {
      // Find most recent log file
      const files = await fs.readdir(LOG_DIR);
      const logFiles = files
        .filter((f) => f.startsWith("brian-") && f.endsWith(".log"))
        .sort()
        .reverse();

      if (logFiles.length === 0) {
        return "No log files found";
      }

      const latestLog = path.join(LOG_DIR, logFiles[0]);
      const content = await fs.readFile(latestLog, "utf-8");
      let logLines = content.split("\n").filter(Boolean);

      // Apply filter if provided
      if (filter) {
        logLines = logLines.filter((line) =>
          line.toLowerCase().includes(filter.toLowerCase())
        );
      }

      // Get last N lines
      const recentLines = logLines.slice(-lines);

      if (recentLines.length === 0) {
        return filter
          ? `No log lines matching "${filter}"`
          : "No log content found";
      }

      return `Recent logs (${recentLines.length} lines):\n\n${recentLines.join("\n")}`;
    } catch (err) {
      return `Error reading logs: ${(err as Error).message}`;
    }
  },
};

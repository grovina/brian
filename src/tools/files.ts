import fs from "fs/promises";
import path from "path";
import type { Tool } from "./index.js";

export const readFileTool: Tool = {
  name: "read_file",
  definition: {
    name: "read_file",
    description: "Read the contents of a file.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to read",
        },
      },
      required: ["path"],
    },
  },
  async execute(input) {
    const { path: filePath } = input as { path: string };
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return `File not found: ${filePath}`;
      throw err;
    }
  },
};

export const writeFileTool: Tool = {
  name: "write_file",
  definition: {
    name: "write_file",
    description: "Write content to a file. Creates parent directories as needed.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to write",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
  async execute(input) {
    const { path: filePath, content } = input as {
      path: string;
      content: string;
    };
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
    return `Wrote ${content.length} bytes to ${filePath}`;
  },
};

export const listFilesTool: Tool = {
  name: "list_files",
  definition: {
    name: "list_files",
    description: "List files and directories at a given path.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path to list",
        },
      },
      required: ["path"],
    },
  },
  async execute(input) {
    const { path: dirPath } = input as { path: string };
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      return entries
        .map((e) => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`)
        .join("\n");
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return `Directory not found: ${dirPath}`;
      throw err;
    }
  },
};

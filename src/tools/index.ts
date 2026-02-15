import type Anthropic from "@anthropic-ai/sdk";
import { bashTool } from "./bash.js";
import { readFileTool, writeFileTool, listFilesTool } from "./files.js";
import {
  memoryReadTool,
  memoryWriteTool,
  memorySearchTool,
} from "./memory.js";
import { selfDeployTool } from "./self-deploy.js";

export interface Tool {
  name: string;
  definition: Anthropic.Tool;
  execute(input: Record<string, unknown>): Promise<string>;
}

const allTools: Tool[] = [
  bashTool,
  readFileTool,
  writeFileTool,
  listFilesTool,
  memoryReadTool,
  memoryWriteTool,
  memorySearchTool,
  selfDeployTool,
];

const toolMap = new Map(allTools.map((t) => [t.name, t]));

export function getToolDefinitions(): Anthropic.Tool[] {
  return allTools.map((t) => t.definition);
}

export function getTool(name: string): Tool | undefined {
  return toolMap.get(name);
}

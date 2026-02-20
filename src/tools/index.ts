export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ImageData {
  mimeType: string;
  data: string;
}

export type ToolResult = string | { text: string; images?: ImageData[] };

export interface Tool {
  name: string;
  definition: ToolDefinition;
  execute(input: Record<string, unknown>): Promise<ToolResult>;
}

import { bashTool } from "./bash.js";
import { readFileTool, writeFileTool, listFilesTool } from "./files.js";
import {
  memoryReadTool,
  memoryWriteTool,
  memorySearchTool,
} from "./memory.js";
import { selfDeployTool } from "./self-deploy.js";
import { slackReadTool, slackPostTool, slackReactTool } from "./slack.js";

const allTools: Tool[] = [
  bashTool,
  readFileTool,
  writeFileTool,
  listFilesTool,
  memoryReadTool,
  memoryWriteTool,
  memorySearchTool,
  selfDeployTool,
  slackReadTool,
  slackPostTool,
  slackReactTool,
];

const toolMap = new Map(allTools.map((t) => [t.name, t]));

export function getToolDefinitions(): ToolDefinition[] {
  return allTools.map((t) => t.definition);
}

export function getTool(name: string): Tool | undefined {
  return toolMap.get(name);
}

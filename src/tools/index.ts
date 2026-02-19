import type Anthropic from "@anthropic-ai/sdk";
import { bashTool } from "./bash.js";
import { readFileTool, writeFileTool, listFilesTool } from "./files.js";
import {
  memoryReadTool,
  memoryWriteTool,
  memorySearchTool,
} from "./memory.js";
import { selfDeployTool } from "./self-deploy.js";
import { slackReadTool, slackPostTool, slackReactTool } from "./slack.js";

export type ToolResult = string | Anthropic.ToolResultBlockParam["content"];

export interface Tool {
  name: string;
  definition: Anthropic.Tool;
  execute(input: Record<string, unknown>): Promise<ToolResult>;
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
  slackReadTool,
  slackPostTool,
  slackReactTool,
];

const toolMap = new Map(allTools.map((t) => [t.name, t]));

export function getToolDefinitions(): Anthropic.Tool[] {
  return allTools.map((t) => t.definition);
}

export function getTool(name: string): Tool | undefined {
  return toolMap.get(name);
}

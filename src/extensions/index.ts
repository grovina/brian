import type { Tool } from "../types.js";
import type { MCPServerConfig } from "../mcp.js";

export interface Extension {
  name: string;
  description: string;
  setup?: () => Promise<void>;
  tools?: Tool[];
  mcpServers?: MCPServerConfig[];
}

export const extensionsRegistry = new Map<string, Extension>();

export function registerExtension(extension: Extension) {
  extensionsRegistry.set(extension.name, extension);
}

// Export and register built-in extensions
export * from "./browser/index.js";
export * from "./coding/index.js";

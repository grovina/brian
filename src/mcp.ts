import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolDefinition, Tool, ToolResult } from "./types.js";
import { homedir } from "os";
import path from "path";
import fs from "fs/promises";

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface MCPToolInfo {
  serverName: string;
  originalName: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

function resolveEnvVars(env: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = value.replace(
      /\$\{(\w+)\}/g,
      (_, name) => process.env[name] ?? ""
    );
  }
  return resolved;
}

const localBin = path.join(homedir(), ".local", "bin");
const augmentedPath = `${localBin}:${process.env.PATH ?? ""}`;

export class MCPManager {
  private clients = new Map<string, Client>();
  private toolMap = new Map<string, MCPToolInfo>();

  async addServer(config: MCPServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: {
        ...(process.env as Record<string, string>),
        PATH: augmentedPath,
        ...(config.env ? resolveEnvVars(config.env) : {}),
      },
    });

    const client = new Client(
      { name: "brian-mcp-client", version: "1.0.0" },
      { capabilities: {} }
    );

    await client.connect(transport);
    this.clients.set(config.name, client);

    const toolsList = await client.listTools();
    for (const tool of toolsList.tools) {
      const qualifiedName = `${config.name}__${tool.name}`;
      this.toolMap.set(qualifiedName, {
        serverName: config.name,
        originalName: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
      });
    }

    console.log(
      `[MCP] ${config.name}: ${toolsList.tools.length} tools`
    );
  }

  async loadDirectory(dirPath: string): Promise<void> {
    let files: string[];
    try {
      files = await fs.readdir(dirPath);
    } catch {
      return;
    }

    for (const file of files.filter((f) => f.endsWith(".json"))) {
      try {
        const data = await fs.readFile(path.join(dirPath, file), "utf-8");
        const config: MCPServerConfig = JSON.parse(data);
        await this.addServer(config);
      } catch (err) {
        console.error(`Failed to load MCP server ${file}:`, err);
      }
    }
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.toolMap.entries()).map(([name, info]) => ({
      name,
      description: info.description ?? `Tool from ${info.serverName}`,
      parameters: info.inputSchema,
    }));
  }

  async executeTool(
    qualifiedName: string,
    input: Record<string, unknown>
  ): Promise<string> {
    const info = this.toolMap.get(qualifiedName);
    if (!info) throw new Error(`Unknown MCP tool: ${qualifiedName}`);

    const client = this.clients.get(info.serverName);
    if (!client)
      throw new Error(`MCP server not connected: ${info.serverName}`);

    const result = await client.callTool({
      name: info.originalName,
      arguments: input,
    });

    if (result.content && Array.isArray(result.content)) {
      return result.content
        .map((item: any) =>
          item.type === "text" ? item.text : JSON.stringify(item)
        )
        .join("\n");
    }

    return JSON.stringify(result);
  }

  isMCPTool(name: string): boolean {
    return name.includes("__");
  }

  async close(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
    this.toolMap.clear();
  }
}

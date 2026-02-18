import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type Anthropic from "@anthropic-ai/sdk";
import { homedir } from "os";
import path from "path";

export interface MCPServer {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface MCPTool {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

// Ensure ~/.local/bin is in PATH so uvx/uv are found
const localBin = path.join(homedir(), ".local", "bin");
const augmentedEnv: Record<string, string> = {
  ...(process.env as Record<string, string>),
  PATH: `${localBin}:${process.env.PATH ?? ""}`,
};

class MCPClientManager {
  private clients: Map<string, Client> = new Map();
  private toolMap: Map<string, { server: string; tool: MCPTool }> = new Map();

  async addServer(server: MCPServer): Promise<void> {
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args || [],
      env: { ...augmentedEnv, ...server.env },
    });

    const client = new Client(
      { name: "brian-mcp-client", version: "1.0.0" },
      { capabilities: {} }
    );

    await client.connect(transport);
    this.clients.set(server.name, client);

    const toolsList = await client.listTools();
    for (const tool of toolsList.tools) {
      const toolName = `${server.name}__${tool.name}`;
      this.toolMap.set(toolName, { server: server.name, tool });
    }

    console.log(`[MCP] Connected to ${server.name}, loaded ${toolsList.tools.length} tools`);
  }

  async close(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
    this.toolMap.clear();
  }

  getToolDefinitions(): Anthropic.Tool[] {
    const tools: Anthropic.Tool[] = [];
    for (const [toolName, { tool }] of this.toolMap) {
      tools.push({
        name: toolName,
        description: tool.description || `Tool from MCP server`,
        input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
      });
    }
    return tools;
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<string> {
    const toolInfo = this.toolMap.get(toolName);
    if (!toolInfo) throw new Error(`Unknown MCP tool: ${toolName}`);

    const client = this.clients.get(toolInfo.server);
    if (!client) throw new Error(`MCP server not connected: ${toolInfo.server}`);

    const result = await client.callTool({
      name: toolInfo.tool.name,
      arguments: input,
    });

    if (result.content && Array.isArray(result.content)) {
      return result.content
        .map((item) => (item.type === "text" ? item.text : JSON.stringify(item)))
        .join("\n");
    }

    return JSON.stringify(result);
  }

  hasTools(): boolean {
    return this.toolMap.size > 0;
  }
}

export const mcpManager = new MCPClientManager();

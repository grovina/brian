import path from "path";
import { homedir } from "os";
import fs from "fs/promises";
import type { BrianConfig, Tool } from "./types.js";
import { Agent } from "./agent.js";
import { MCPManager } from "./mcp.js";
import { memoryTools } from "./tools/memory.js";
import { initLogger } from "./logger.js";

export class Brian {
  private config: BrianConfig;
  private stateDir: string;
  private mcp: MCPManager;
  private agent!: Agent;

  constructor(config: BrianConfig) {
    this.config = config;
    this.stateDir = config.stateDir ?? path.join(homedir(), ".brian");
    this.mcp = new MCPManager();
  }

  async start(): Promise<void> {
    await fs.mkdir(this.stateDir, { recursive: true });
    initLogger(this.stateDir);

    console.log(`${this.config.name} starting up...`);

    await this.loadMCP();

    const tools = this.resolveTools();
    this.agent = new Agent({
      name: this.config.name,
      stateDir: this.stateDir,
      model: this.config.model,
      tools,
      mcp: this.mcp,
      instructions: this.config.instructions,
    });

    await this.agent.init();

    console.log(
      `${this.config.name} running — ${tools.length} tools, ${this.mcp.getToolDefinitions().length} MCP tools`
    );

    process.on("SIGINT", () => this.shutdown());
    process.on("SIGTERM", () => this.shutdown());

    await this.config.wake.start(() => this.agent.run());
  }

  private resolveTools(): Tool[] {
    const tools: Tool[] = [];

    // Built-in: memory tools
    tools.push(...memoryTools(this.stateDir));

    // Built-in: set_wake_interval
    tools.push(this.createWakeIntervalTool());

    // User-provided tools (flatten nested arrays)
    if (this.config.tools) {
      for (const entry of this.config.tools) {
        if (Array.isArray(entry)) {
          tools.push(...entry);
        } else {
          tools.push(entry);
        }
      }
    }

    return tools;
  }

  private createWakeIntervalTool(): Tool {
    return {
      name: "set_wake_interval",
      definition: {
        name: "set_wake_interval",
        description:
          "Set how many minutes until the next wake. Use this to control your own schedule — short intervals when you're actively working on something, longer when things are quiet.",
        parameters: {
          type: "object",
          properties: {
            minutes: {
              type: "number",
              description: "Minutes until next wake",
            },
            reason: {
              type: "string",
              description: "Why this interval (for your own logs)",
            },
          },
          required: ["minutes"],
        },
      },
      execute: async (input) => {
        const { minutes, reason } = input as {
          minutes: number;
          reason?: string;
        };
        this.agent.setNextWake(minutes);
        const msg = `Wake interval set to ${minutes} minutes`;
        return reason ? `${msg} (${reason})` : msg;
      },
    };
  }

  private async loadMCP(): Promise<void> {
    if (!this.config.mcp) return;

    const paths = Array.isArray(this.config.mcp)
      ? this.config.mcp
      : [this.config.mcp];

    for (const mcpPath of paths) {
      const resolved = path.resolve(mcpPath);
      const stat = await fs.stat(resolved).catch(() => null);

      if (stat?.isDirectory()) {
        await this.mcp.loadDirectory(resolved);
      } else if (stat?.isFile() && resolved.endsWith(".json")) {
        const data = await fs.readFile(resolved, "utf-8");
        const config = JSON.parse(data);
        if (config.servers && Array.isArray(config.servers)) {
          for (const server of config.servers) {
            await this.mcp.addServer(server);
          }
        } else {
          await this.mcp.addServer(config);
        }
      }
    }
  }

  private async shutdown(): Promise<void> {
    console.log(`${this.config.name} shutting down...`);
    await this.config.wake.stop();
    await this.mcp.close();
    process.exit(0);
  }
}

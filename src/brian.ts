import path from "path";
import { homedir } from "os";
import fs from "fs/promises";
import type { BrianConfig } from "./types.js";
import { Agent } from "./agent.js";
import { UpdateQueue } from "./updates.js";
import { Slack } from "./slack.js";
import { slackTools } from "./tools/slack.js";
import { log } from "./logs.js";

export class Brian {
  private config: BrianConfig;
  private stateDir: string;
  private slack: Slack | null = null;
  private updates = new UpdateQueue();

  constructor(config: BrianConfig) {
    this.config = config;
    this.stateDir = config.stateDir ?? path.join(homedir(), ".brian");
  }

  async start(): Promise<void> {
    await fs.mkdir(this.stateDir, { recursive: true });

    log("agent starting");

    if (this.config.slack) {
      this.slack = new Slack({
        token: this.config.slack.token,
        stateDir: this.stateDir,
      });
      this.slack.startPolling(this.updates);
      log("slack polling started");
    }

    const tools = [
      ...(this.config.tools ?? []),
      ...(this.slack ? slackTools(this.slack) : []),
    ];

    const agent = new Agent({
      name: this.config.name,
      stateDir: this.stateDir,
      model: this.config.model,
      tools,
      updates: this.updates,
    });

    log(`agent running with ${tools.length} tools`);

    process.on("SIGINT", () => this.shutdown());
    process.on("SIGTERM", () => this.shutdown());

    await agent.loop();
  }

  private async shutdown(): Promise<void> {
    log("agent shutting down");
    this.slack?.stopPolling();
    process.exit(0);
  }
}

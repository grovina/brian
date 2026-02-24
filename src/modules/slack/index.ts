import fs from "fs/promises";
import path from "path";
import type { Module } from "../types.js";

const mcpConfig = {
  name: "slack",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-slack"],
  env: {
    SLACK_BOT_TOKEN: "${SLACK_TOKEN}",
    SLACK_TEAM_ID: "${SLACK_TEAM_ID}",
  },
};

export const slackModule: Module = {
  meta: {
    id: "slack",
    name: "Slack",
    description: "Slack messaging integration via MCP",
    default: true,
  },

  async check(ctx) {
    const issues: string[] = [];

    const mcpPath = path.join(ctx.stateDir, "mcp", "slack.json");
    try {
      await fs.access(mcpPath);
    } catch {
      issues.push("mcp/slack.json not found");
    }

    if (!process.env.SLACK_TOKEN) issues.push("SLACK_TOKEN not set");
    if (!process.env.SLACK_TEAM_ID) issues.push("SLACK_TEAM_ID not set");

    return { installed: issues.length === 0, issues };
  },

  async install(ctx) {
    const mcpDir = path.join(ctx.stateDir, "mcp");
    await fs.mkdir(mcpDir, { recursive: true });
    await fs.writeFile(
      path.join(mcpDir, "slack.json"),
      JSON.stringify(mcpConfig, null, 2) + "\n"
    );

    const contextDir = path.join(ctx.stateDir, "context");
    await fs.mkdir(contextDir, { recursive: true });
    await fs.writeFile(
      path.join(contextDir, "slack.md"),
      "## Slack\n\nSlack is configured. Use slack__* tools for messaging, channel management, and team communication.\n"
    );
  },
};

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

const help = `\
Slack — team messaging integration

Prerequisites:
  SLACK_TOKEN     Bot token (xoxp-...) in /etc/brian/env
  SLACK_TEAM_ID   Workspace ID (T...) in /etc/brian/env

Setup guide: docs/slack-setup.md

Usage:
  Slack is available as MCP tools (prefixed slack__).
  Key tools:
    slack__slack_post_message        Send a message to a channel
    slack__slack_get_channel_history  Read recent channel messages
    slack__slack_reply_to_thread     Reply in a thread
    slack__slack_get_thread_replies   Read thread replies

  Requires restart after install: brian redeploy

Tips:
  Use threads for ongoing conversations rather than top-level messages.
  Check channel history on wake to catch up on missed messages.`;

export const slackModule: Module = {
  meta: {
    id: "slack",
    name: "Slack",
    description: "Slack messaging via MCP",
    default: true,
    usage: "slack__ MCP tools",
    help,
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
      "## Slack\n\nSlack configured — use slack__ MCP tools. See: brian module help slack\n"
    );
  },
};

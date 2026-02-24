import fs from "fs/promises";
import path from "path";
import type { Module } from "../types.js";

const mcpConfig = {
  name: "github",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  env: {
    GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}",
  },
};

export const githubModule: Module = {
  meta: {
    id: "github",
    name: "GitHub",
    description: "GitHub integration via MCP",
    default: true,
  },

  async check(ctx) {
    const issues: string[] = [];

    const mcpPath = path.join(ctx.appDir, "mcp", "github.json");
    try {
      await fs.access(mcpPath);
    } catch {
      issues.push("mcp/github.json not found in app directory");
    }

    if (!process.env.GITHUB_TOKEN) issues.push("GITHUB_TOKEN not set");

    return { installed: issues.length === 0, issues };
  },

  async install(ctx) {
    const mcpDir = path.join(ctx.appDir, "mcp");
    await fs.mkdir(mcpDir, { recursive: true });
    await fs.writeFile(
      path.join(mcpDir, "github.json"),
      JSON.stringify(mcpConfig, null, 2) + "\n"
    );

    const contextDir = path.join(ctx.stateDir, "context");
    await fs.mkdir(contextDir, { recursive: true });
    await fs.writeFile(
      path.join(contextDir, "github.md"),
      "## GitHub\n\nGitHub is configured. Use github__* tools for repositories, pull requests, issues, and code review.\n"
    );
  },
};

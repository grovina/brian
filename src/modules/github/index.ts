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

const help = `\
GitHub — repository and code collaboration

Prerequisites:
  GITHUB_TOKEN   Classic PAT with repo scope (ghp_...) in /etc/brian/env

Setup guide: docs/github-setup.md

Usage:
  GitHub is available as MCP tools (prefixed github__).
  Key tools:
    github__list_pull_requests   List PRs in a repo
    github__create_pull_request  Open a new PR
    github__search_issues        Search issues and PRs
    github__list_commits         View commit history
    github__get_file_contents    Read a file from a repo

  Requires restart after install: brian redeploy

Tips:
  Use PRs for code changes rather than pushing directly to main.
  When opening PRs to upstream, keep changes focused and well-described.`;

export const githubModule: Module = {
  meta: {
    id: "github",
    name: "GitHub",
    description: "GitHub integration via MCP",
    default: true,
    usage: "github__ MCP tools",
    help,
  },

  async check(ctx) {
    const issues: string[] = [];

    const mcpPath = path.join(ctx.stateDir, "mcp", "github.json");
    try {
      await fs.access(mcpPath);
    } catch {
      issues.push("mcp/github.json not found");
    }

    if (!process.env.GITHUB_TOKEN) issues.push("GITHUB_TOKEN not set");

    return { installed: issues.length === 0, issues };
  },

  async install(ctx) {
    const mcpDir = path.join(ctx.stateDir, "mcp");
    await fs.mkdir(mcpDir, { recursive: true });
    await fs.writeFile(
      path.join(mcpDir, "github.json"),
      JSON.stringify(mcpConfig, null, 2) + "\n"
    );

    const contextDir = path.join(ctx.stateDir, "context");
    await fs.mkdir(contextDir, { recursive: true });
    await fs.writeFile(
      path.join(contextDir, "github.md"),
      "## GitHub\n\nGitHub configured — use github__ MCP tools. See: brian module help github\n"
    );
  },
};

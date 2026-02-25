import { promisify } from "util";
import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import type { Module } from "../types.js";

const execFileAsync = promisify(execFile);

async function getClaudeVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("claude", ["--version"], {
      timeout: 5_000,
    });
    return stdout.trim().split("\n")[0] ?? null;
  } catch {
    return null;
  }
}

const help = `\
Claude Code — coding assistance via CLI

Prerequisites:
  claude CLI in PATH (npm install -g @anthropic-ai/claude-code)
  ANTHROPIC_API_KEY in /etc/brian/env

Usage:
  claude --print "<task>"

Use for coding tasks that benefit from Claude's reasoning capabilities.
Good for code review, refactoring, and complex problem-solving.`;

export const claudeModule: Module = {
  meta: {
    id: "claude",
    name: "Claude Code",
    description: "Coding assistance via Claude Code CLI",
    usage: 'claude --print "<task>"',
    help,
  },

  async check() {
    const version = await getClaudeVersion();
    if (version) {
      return { installed: true, version };
    }
    return {
      installed: false,
      issues: ["claude CLI not found in PATH"],
    };
  },

  async install(ctx) {
    const version = await getClaudeVersion();

    const contextDir = path.join(ctx.stateDir, "context");
    await fs.mkdir(contextDir, { recursive: true });

    if (!version) {
      try {
        await execFileAsync("npm", ["install", "-g", "@anthropic-ai/claude-code"], {
          timeout: 60_000,
        });
      } catch {
        await fs.writeFile(
          path.join(contextDir, "claude.md"),
          "## Claude Code\n\nClaude Code CLI not installed. Install: brian module install claude\n"
        );
        return;
      }
    }

    const installedVersion = await getClaudeVersion();
    const ver = installedVersion ? ` (${installedVersion})` : "";
    await fs.writeFile(
      path.join(contextDir, "claude.md"),
      `## Claude Code\n\nClaude Code CLI available${ver}. See: brian module help claude\n`
    );
  },
};

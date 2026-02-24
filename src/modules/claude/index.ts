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

export const claudeModule: Module = {
  meta: {
    id: "claude",
    name: "Claude Code",
    description: "Coding assistance via Claude Code CLI",
  },

  async check() {
    const version = await getClaudeVersion();
    if (version) {
      return { installed: true, version };
    }
    return {
      installed: false,
      issues: [
        "claude CLI not found in PATH. Install with: npm install -g @anthropic-ai/claude-code",
      ],
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
          "## Claude Code\n\nClaude Code CLI installation failed. Try manually: `npm install -g @anthropic-ai/claude-code`\n"
        );
        return;
      }
    }

    const installedVersion = await getClaudeVersion();
    await fs.writeFile(
      path.join(contextDir, "claude.md"),
      `## Claude Code\n\nClaude Code CLI is available${installedVersion ? ` (${installedVersion})` : ""}. Use \`bash\` to run \`claude\` commands for coding tasks.\n`
    );
  },
};

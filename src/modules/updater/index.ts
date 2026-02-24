import { promisify } from "util";
import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import type { Module } from "../types.js";

const execFileAsync = promisify(execFile);

async function runGit(
  dir: string,
  args: string[]
): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", dir, ...args], {
    timeout: 15_000,
  });
  return stdout.trim();
}

export const updaterModule: Module = {
  meta: {
    id: "updater",
    name: "Fork Updater",
    description:
      "Monitors framework fork for upstream changes and writes status to context",
    default: true,
  },

  async check(ctx) {
    const issues: string[] = [];

    try {
      await runGit(ctx.frameworkDir, ["rev-parse", "--is-inside-work-tree"]);
    } catch {
      issues.push(`Framework directory not a git repo: ${ctx.frameworkDir}`);
      return { installed: false, issues };
    }

    try {
      await runGit(ctx.frameworkDir, ["remote", "get-url", "upstream"]);
    } catch {
      try {
        await runGit(ctx.frameworkDir, ["remote", "get-url", "origin"]);
      } catch {
        issues.push("No upstream or origin remote found");
      }
    }

    return { installed: issues.length === 0, issues };
  },

  async install(ctx) {
    try {
      await runGit(ctx.frameworkDir, ["remote", "get-url", "upstream"]);
    } catch {
      try {
        await runGit(ctx.frameworkDir, [
          "remote",
          "add",
          "upstream",
          "https://github.com/grovina/brian.git",
        ]);
      } catch {
        // upstream might already exist under a different url
      }
    }

    await syncCheck(ctx);
  },
};

export async function syncCheck(ctx: {
  frameworkDir: string;
  stateDir: string;
}): Promise<void> {
  const contextDir = path.join(ctx.stateDir, "context");
  await fs.mkdir(contextDir, { recursive: true });
  const statusFile = path.join(contextDir, "fork-status.md");

  try {
    await runGit(ctx.frameworkDir, ["fetch", "--all", "--prune"]);

    let upstream = "upstream";
    try {
      await runGit(ctx.frameworkDir, ["remote", "get-url", upstream]);
    } catch {
      upstream = "origin";
    }

    const branch = "main";
    const range = `origin/${branch}...${upstream}/${branch}`;
    const counts = await runGit(ctx.frameworkDir, [
      "rev-list",
      "--left-right",
      "--count",
      range,
    ]);
    const [aheadRaw, behindRaw] = counts.split(/\s+/);
    const ahead = parseInt(aheadRaw ?? "0", 10) || 0;
    const behind = parseInt(behindRaw ?? "0", 10) || 0;

    const now = new Date().toISOString();
    let status = `## Fork Status\n\nChecked: ${now}\n`;

    if (behind > 0) {
      status += `\nFork is **${behind} commits behind** ${upstream}/${branch}. Consider syncing: \`brian sync\`\n`;
    }
    if (ahead > 0) {
      status += `\nFork is **${ahead} commits ahead** of ${upstream}/${branch}. Consider opening a PR to upstream.\n`;
    }
    if (ahead === 0 && behind === 0) {
      status += `\nFork is up to date with ${upstream}/${branch}.\n`;
    }

    await fs.writeFile(statusFile, status);
  } catch (err) {
    await fs.writeFile(
      statusFile,
      `## Fork Status\n\nCheck failed: ${(err as Error).message}\n`
    );
  }
}

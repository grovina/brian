import { promisify } from "util";
import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import type { Module } from "../types.js";

const execFileAsync = promisify(execFile);

async function getCursorVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("cursor", ["--version"], {
      timeout: 5_000,
    });
    return stdout.trim().split("\n")[0] ?? null;
  } catch {
    return null;
  }
}

export const cursorModule: Module = {
  meta: {
    id: "cursor",
    name: "Cursor",
    description: "IDE-assisted coding via Cursor CLI",
  },

  async check() {
    const version = await getCursorVersion();
    if (version) {
      return { installed: true, version };
    }
    return {
      installed: false,
      issues: [
        "cursor CLI not found in PATH. Install from https://www.cursor.com",
      ],
    };
  },

  async install(ctx) {
    const version = await getCursorVersion();

    const contextDir = path.join(ctx.stateDir, "context");
    await fs.mkdir(contextDir, { recursive: true });

    if (version) {
      await fs.writeFile(
        path.join(contextDir, "cursor.md"),
        `## Cursor\n\nCursor CLI is available (${version}). Use \`bash\` to run \`cursor\` commands for IDE-assisted coding tasks.\n`
      );
    } else {
      await fs.writeFile(
        path.join(contextDir, "cursor.md"),
        "## Cursor\n\nCursor CLI is not installed. Install from https://www.cursor.com to enable IDE-assisted coding.\n"
      );
    }
  },
};

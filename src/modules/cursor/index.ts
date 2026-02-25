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

const help = `\
Cursor — IDE-assisted coding via headless CLI

Prerequisites:
  cursor CLI in PATH
  CURSOR_API_KEY in /etc/brian/env

Usage:
  cursor agent --print --trust --yolo "<task>" < /dev/null

  --print      Headless output (no interactive UI)
  --trust      Allow file system operations
  --yolo       Auto-approve tool calls
  < /dev/null  Prevent stdin blocking

Use for complex coding tasks that benefit from Cursor's context-aware
editing. Good for multi-file refactors, debugging, and code generation.

If cursor CLI is not installed, download the AppImage from cursor.com,
extract it, and symlink the binary to /usr/local/bin/cursor.`;

export const cursorModule: Module = {
  meta: {
    id: "cursor",
    name: "Cursor",
    description: "IDE-assisted coding via Cursor CLI",
    usage: 'cursor agent --print --trust --yolo "<task>" < /dev/null',
    help,
  },

  async check() {
    const version = await getCursorVersion();
    if (version) {
      return { installed: true, version };
    }
    return {
      installed: false,
      issues: ["cursor CLI not found in PATH"],
    };
  },

  async install(ctx) {
    const version = await getCursorVersion();
    const contextDir = path.join(ctx.stateDir, "context");
    await fs.mkdir(contextDir, { recursive: true });

    if (version) {
      await fs.writeFile(
        path.join(contextDir, "cursor.md"),
        `## Cursor\n\nCursor CLI available (${version}). See: brian module help cursor\n`
      );
    } else {
      await fs.writeFile(
        path.join(contextDir, "cursor.md"),
        "## Cursor\n\nCursor CLI not installed. Install: brian module install cursor\n"
      );
    }
  },
};

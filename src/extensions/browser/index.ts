import { Extension, registerExtension } from "../index.js";
import { execSync } from "child_process";
import fs from "fs/promises";
import path from "path";

export const browserExtension: Extension = {
  name: "browser",
  description: "Enables web browsing via Chromium and Chrome MCP",
  setup: async () => {
    // 1. Check if chromium is installed
    try {
      execSync("which chromium", { stdio: "ignore" });
    } catch (e) {
      console.log("[Browser Extension] Chromium not found. Installing...");
      // This assumes passwordless sudo is available as per our previous work
      execSync("sudo apt-get update && sudo apt-get install -y chromium", { stdio: "inherit" });
    }

    // 2. Note: Chrome MCP build/install logic would ideally be here too,
    // but for the sketch we'll focus on the MCP config integration.
  },
  mcpServers: [
    {
      name: "chrome",
      command: "node",
      args: [
        // In a real plugin, this path would be relative to the plugin or a shared location
        "/home/brian/tools/chrome-mcp/build/src/index.js",
        "--headless",
        "--chrome-arg=--no-sandbox",
        "--chrome-arg=--disable-setuid-sandbox",
        "--executablePath",
        "/usr/bin/chromium",
        "--slim"
      ]
    }
  ]
};

registerExtension(browserExtension);

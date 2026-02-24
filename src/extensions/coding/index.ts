import { Extension, registerExtension } from "../index.js";
import { execSync } from "child_process";

export const codingExtension: Extension = {
  name: "coding",
  description: "Advanced coding tools (placeholder for Cursor/Claude Code integrations)",
  setup: async () => {
    console.log("[Coding Extension] Checking for advanced coding tools...");
    // Future: check and install 'claude-code' or other CLI tools
  },
  tools: [
    // Future: provide specialized tools that wrap these IDE features
  ]
};

registerExtension(codingExtension);

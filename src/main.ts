import "./logger.js";
import { config } from "./config.js";
import { runAgent } from "./agent.js";
import { mcpManager } from "./mcp-client.js";
import fs from "fs/promises";
import path from "path";

const MCP_CONFIG_FILE = path.join(
  process.env.HOME || "/home/brian",
  ".brian",
  "mcp-servers.json"
);

async function loadMCPServers(): Promise<void> {
  try {
    const configData = await fs.readFile(MCP_CONFIG_FILE, "utf-8");
    const mcpConfig = JSON.parse(configData);

    if (mcpConfig.servers && Array.isArray(mcpConfig.servers)) {
      for (const server of mcpConfig.servers) {
        await mcpManager.addServer(server);
      }
      console.log(`Loaded ${mcpConfig.servers.length} MCP server(s)`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.log("No MCP servers configured");
    } else {
      console.error("Failed to load MCP servers:", err);
    }
  }
}

console.log(`${config.name} starting up...`);
await loadMCPServers();

const intervalMs = config.wakeIntervalMinutes * 60_000;
console.log(`${config.name} running — waking every ${config.wakeIntervalMinutes} min`);

while (true) {
  try {
    await runAgent();
  } catch (err) {
    console.error("Agent error:", err);
  }

  await new Promise((r) => setTimeout(r, intervalMs));
}

process.on("SIGINT", async () => {
  await mcpManager.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await mcpManager.close();
  process.exit(0);
});

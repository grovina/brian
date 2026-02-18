import "./logger.js";
import { config } from "./config.js";
import { runAgent } from "./agent.js";
import { getNewMessages } from "./slack.js";
import { postMessage } from "./slack.js";
import { readHeartbeat } from "./memory.js";
import { mcpManager } from "./mcp-client.js";
import fs from "fs/promises";
import path from "path";

const STATE_DIR = path.join(process.env.HOME || "/home/brian", ".brian");
const TS_FILE = path.join(STATE_DIR, "last-slack-ts");
const MCP_CONFIG_FILE = path.join(STATE_DIR, "mcp-servers.json");

async function loadLastTs(): Promise<string> {
  try {
    return (await fs.readFile(TS_FILE, "utf-8")).trim();
  } catch {
    return String(Date.now() / 1000);
  }
}

async function saveLastTs(ts: string): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(TS_FILE, ts);
}

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
      console.log("No MCP servers configured (create ~/.brian/mcp-servers.json to add)");
    } else {
      console.error("Failed to load MCP servers:", err);
    }
  }
}

function isWithinActiveHours(): boolean {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = config.heartbeat.activeHoursStart.split(":").map(Number);
  const [endH, endM] = config.heartbeat.activeHoursEnd.split(":").map(Number);
  return currentMinutes >= startH * 60 + startM && currentMinutes <= endH * 60 + endM;
}

async function loop(): Promise<void> {
  let lastTs = await loadLastTs();
  let lastHeartbeat = Date.now();
  const heartbeatIntervalMs = config.heartbeat.intervalMinutes * 60_000;
  const pollIntervalMs = config.pollIntervalSeconds * 1_000;

  console.log(`${config.name} running — polling every ${config.pollIntervalSeconds}s`);

  while (true) {
    try {
      const messages = await getNewMessages(lastTs);

      for (const msg of messages) {
        console.log(`[slack] ${msg.user}: ${JSON.stringify(msg.content).substring(0, 100)}`);
        const result = await runAgent(msg.content);
        await postMessage(result.response);
        lastTs = msg.ts;
        await saveLastTs(lastTs);
      }

      if (
        Date.now() - lastHeartbeat > heartbeatIntervalMs &&
        isWithinActiveHours()
      ) {
        const checklist = await readHeartbeat();
        if (checklist.trim()) {
          const result = await runAgent(
            `[Heartbeat] Periodic check. Checklist:\n\n${checklist}\n\nGo through each item. If nothing needs attention, just say "all clear". Otherwise describe what you found.`
          );
          const response = result.response.toLowerCase();
          if (!response.includes("all clear") && !response.includes("nothing to report")) {
            await postMessage(result.response);
          }
        }
        lastHeartbeat = Date.now();
      }
    } catch (err) {
      console.error("Loop error:", err);
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

console.log(`${config.name} starting up...`);
await loadMCPServers();
loop();

process.on("SIGINT", async () => {
  await mcpManager.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await mcpManager.close();
  process.exit(0);
});

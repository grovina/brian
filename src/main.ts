import "./logger.js";
import { config } from "./config.js";
import { runAgent } from "./agent.js";
import { mcpManager } from "./mcp-client.js";
import { fetchMessages } from "./slack.js";
import fs from "fs/promises";
import path from "path";

const STATE_DIR = path.join(process.env.HOME || "/home/brian", ".brian");
const TS_FILE = path.join(STATE_DIR, "last-slack-ts");
const MCP_CONFIG_FILE = path.join(STATE_DIR, "mcp-servers.json");

const MIN_INTERVAL_MS = config.wakeIntervalMinutes * 60_000;
const MAX_INTERVAL_MS = 30 * 60_000;  // extended from 15 to 30 min
const BACKOFF_MULTIPLIER = 1.5;
// Run agent proactively at least once per 2 hours even if no messages
const PROACTIVE_INTERVAL_MS = 2 * 60 * 60_000;

async function loadLastTs(): Promise<string> {
  try {
    return (await fs.readFile(TS_FILE, "utf-8")).trim();
  } catch {
    return String(Date.now() / 1000 - 60);
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
      console.log("No MCP servers configured");
    } else {
      console.error("Failed to load MCP servers:", err);
    }
  }
}

async function checkNewMessages(since: string): Promise<string | null> {
  try {
    const msgs = await fetchMessages({ oldest: since, limit: 10 });
    const newMsgs = msgs.filter((m) => !m.bot_id);
    if (newMsgs.length === 0) return null;
    return newMsgs[newMsgs.length - 1].ts;
  } catch {
    return null;
  }
}

console.log(`${config.name} starting up...`);
await loadMCPServers();

let lastTs = await loadLastTs();
let currentIntervalMs = MIN_INTERVAL_MS;
let lastAgentRunMs = Date.now();

console.log(`${config.name} running — min ${config.wakeIntervalMinutes} min, max 30 min idle`);

while (true) {
  try {
    const latestTs = await checkNewMessages(lastTs);
    const timeSinceLastRun = Date.now() - lastAgentRunMs;
    const shouldRunProactive = timeSinceLastRun >= PROACTIVE_INTERVAL_MS;

    if (latestTs || shouldRunProactive) {
      currentIntervalMs = MIN_INTERVAL_MS;
      await runAgent();
      lastAgentRunMs = Date.now();
      if (latestTs) {
        lastTs = latestTs;
        await saveLastTs(lastTs);
      }
    } else {
      currentIntervalMs = Math.min(
        Math.round(currentIntervalMs * BACKOFF_MULTIPLIER),
        MAX_INTERVAL_MS
      );
      console.log(`[idle] next check in ${Math.round(currentIntervalMs / 1000)}s`);
    }
  } catch (err) {
    console.error("Loop error:", err);
    currentIntervalMs = MIN_INTERVAL_MS;
  }

  await new Promise((r) => setTimeout(r, currentIntervalMs));
}

process.on("SIGINT", async () => { await mcpManager.close(); process.exit(0); });
process.on("SIGTERM", async () => { await mcpManager.close(); process.exit(0); });

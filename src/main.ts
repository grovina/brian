import "./logger.js";
import { config } from "./config.js";
import { runAgent } from "./agent.js";
import { mcpManager } from "./mcp-client.js";
import { getJoinedChannels, fetchMessages, SlackChannel } from "./slack.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..");

const STATE_DIR = path.join(process.env.HOME || "/home/brian", ".brian");
const TS_FILE = path.join(STATE_DIR, "last-slack-ts.json");
const USER_MCP_FILE = path.join(STATE_DIR, "mcp-servers.json");
const KERNEL_MCP_DIR = path.join(APP_DIR, "mcp");

const MIN_INTERVAL_MS = config.wakeIntervalMinutes * 60_000;
const MAX_INTERVAL_MS = 30 * 60_000;
const BACKOFF_MULTIPLIER = 1.5;
const PROACTIVE_INTERVAL_MS = 2 * 60 * 60_000;
const CHANNEL_REFRESH_INTERVAL_MS = 15 * 60_000;

type ChannelTimestamps = Record<string, string>;

async function loadTimestamps(): Promise<ChannelTimestamps> {
  try {
    const data = await fs.readFile(TS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveTimestamps(ts: ChannelTimestamps): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(TS_FILE, JSON.stringify(ts, null, 2));
}

async function loadMCPServers(): Promise<void> {
  let totalLoaded = 0;

  try {
    const files = await fs.readdir(KERNEL_MCP_DIR);
    for (const file of files.filter((f) => f.endsWith(".json"))) {
      try {
        const data = await fs.readFile(path.join(KERNEL_MCP_DIR, file), "utf-8");
        const server = JSON.parse(data);
        await mcpManager.addServer(server);
        totalLoaded++;
      } catch (err) {
        console.error(`Failed to load kernel MCP server ${file}:`, err);
      }
    }
  } catch {
    // No kernel mcp/ directory
  }

  try {
    const configData = await fs.readFile(USER_MCP_FILE, "utf-8");
    const mcpConfig = JSON.parse(configData);
    if (mcpConfig.servers && Array.isArray(mcpConfig.servers)) {
      for (const server of mcpConfig.servers) {
        await mcpManager.addServer(server);
        totalLoaded++;
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("Failed to load user MCP servers:", err);
    }
  }

  console.log(`Loaded ${totalLoaded} MCP server(s)`);
}

interface ChannelActivity {
  channel: SlackChannel;
  newMessages: number;
  latestTs: string;
}

async function checkAllChannels(
  channels: SlackChannel[],
  timestamps: ChannelTimestamps
): Promise<ChannelActivity[]> {
  const active: ChannelActivity[] = [];

  for (const ch of channels) {
    try {
      const oldest = timestamps[ch.id];
      const msgs = await fetchMessages({
        channel: ch.id,
        oldest,
        limit: 10,
      });
      const newMsgs = msgs.filter((m) => !m.bot_id);
      if (newMsgs.length > 0) {
        active.push({
          channel: ch,
          newMessages: newMsgs.length,
          latestTs: newMsgs[newMsgs.length - 1].ts,
        });
      }
    } catch {
      // Channel might be inaccessible — skip silently
    }
  }

  return active;
}

function formatActivityContext(activity: ChannelActivity[]): string {
  if (activity.length === 0) return "";

  const lines = activity.map(
    (a) => `- #${a.channel.name} (${a.channel.id}): ${a.newMessages} new message${a.newMessages > 1 ? "s" : ""}`
  );
  return `\nNew activity:\n${lines.join("\n")}`;
}

// --- startup ---

console.log(`${config.name} starting up...`);
await loadMCPServers();

let channels: SlackChannel[] = [];
try {
  channels = await getJoinedChannels();
  console.log(`Discovered ${channels.length} channel(s): ${channels.map((c) => `#${c.name}`).join(", ")}`);
} catch (err) {
  console.error("Failed to discover channels:", err);
}

let timestamps = await loadTimestamps();
let currentIntervalMs = MIN_INTERVAL_MS;
let lastAgentRunMs = Date.now();
let lastChannelRefreshMs = Date.now();

console.log(`${config.name} running — min ${config.wakeIntervalMinutes} min, max 30 min idle`);

while (true) {
  try {
    // Periodically refresh channel list
    if (Date.now() - lastChannelRefreshMs >= CHANNEL_REFRESH_INTERVAL_MS) {
      try {
        channels = await getJoinedChannels();
        lastChannelRefreshMs = Date.now();
        console.log(`Refreshed channels: ${channels.length} joined`);
      } catch {
        // Keep using stale list
      }
    }

    const activity = await checkAllChannels(channels, timestamps);
    const timeSinceLastRun = Date.now() - lastAgentRunMs;
    const shouldRunProactive = timeSinceLastRun >= PROACTIVE_INTERVAL_MS;

    if (activity.length > 0 || shouldRunProactive) {
      currentIntervalMs = MIN_INTERVAL_MS;

      const activityContext = formatActivityContext(activity);
      await runAgent(activityContext);
      lastAgentRunMs = Date.now();

      for (const a of activity) {
        timestamps[a.channel.id] = a.latestTs;
      }
      await saveTimestamps(timestamps);
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

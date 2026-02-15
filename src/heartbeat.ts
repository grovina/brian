import { config } from "./config.js";
import { readHeartbeat } from "./memory.js";
import { runAgent } from "./agent.js";
import { sendMessageToOwner } from "./telegram.js";

let timer: ReturnType<typeof setInterval> | null = null;

function isWithinActiveHours(): boolean {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentTime = hours * 60 + minutes;

  const [startH, startM] = config.heartbeat.activeHoursStart
    .split(":")
    .map(Number);
  const [endH, endM] = config.heartbeat.activeHoursEnd.split(":").map(Number);
  const startTime = startH * 60 + startM;
  const endTime = endH * 60 + endM;

  return currentTime >= startTime && currentTime <= endTime;
}

async function tick(): Promise<void> {
  if (!isWithinActiveHours()) return;

  try {
    const checklist = await readHeartbeat();
    if (!checklist.trim()) return;

    const result = await runAgent(
      `[Heartbeat] It's time for a periodic check. Here's the current heartbeat checklist:\n\n${checklist}\n\nGo through each item. If nothing needs attention, respond with just "all clear" and don't message the user. If something needs attention, describe what you found.`
    );

    // Only notify the owner if the agent found something noteworthy
    const response = result.response.toLowerCase();
    if (!response.includes("all clear") && !response.includes("nothing to report")) {
      await sendMessageToOwner(result.response);
    }
  } catch (err) {
    console.error("Heartbeat error:", err);
  }
}

export function startHeartbeat(): void {
  const intervalMs = config.heartbeat.intervalMinutes * 60 * 1000;
  timer = setInterval(tick, intervalMs);
  console.log(
    `Heartbeat started: every ${config.heartbeat.intervalMinutes}m, active ${config.heartbeat.activeHoursStart}–${config.heartbeat.activeHoursEnd}`
  );
}

export function stopHeartbeat(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

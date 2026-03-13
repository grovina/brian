import type { Tool } from "../types.js";
import type { UpdateQueue } from "../updates.js";

const MAX_WAIT_MINUTES = 1440;

function formatNow(): string {
  return new Date().toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function createWaitTools(updates: UpdateQueue): Tool[] {
  return [
    {
      name: "wait",
      definition: {
        name: "wait",
        description:
          "Pause execution for a specified duration. Resumes early if an external event (e.g. Slack message) arrives. Use when there's no immediate work to do.",
        parameters: {
          type: "object",
          properties: {
            minutes: {
              type: "number",
              description: "How many minutes to wait (1–1440)",
            },
            reason: {
              type: "string",
              description: "Why waiting is appropriate right now",
            },
          },
          required: ["minutes"],
        },
      },
      async execute(input) {
        const { minutes } = input as { minutes: number; reason?: string };
        const clamped = Math.max(1, Math.min(minutes, MAX_WAIT_MINUTES));
        const wokeEarly = await updates.waitForUpdate(clamped * 60_000);

        const now = formatNow();
        return wokeEarly
          ? `Resumed early — update arrived. It's now ${now}.`
          : `Waited ${clamped} minutes. It's now ${now}.`;
      },
    },
    {
      name: "wait_until",
      definition: {
        name: "wait_until",
        description:
          "Pause execution until a specific date/time. Resumes early if an external event arrives. Useful for scheduling work around known times (meetings, deployments, work hours).",
        parameters: {
          type: "object",
          properties: {
            datetime: {
              type: "string",
              description: "ISO 8601 datetime to wait until (e.g. 2025-03-14T09:00:00Z)",
            },
            reason: {
              type: "string",
              description: "Why waiting until this time",
            },
          },
          required: ["datetime"],
        },
      },
      async execute(input) {
        const { datetime } = input as { datetime: string; reason?: string };
        const target = new Date(datetime);

        if (isNaN(target.getTime())) {
          return `Invalid datetime: ${datetime}`;
        }

        const delayMs = Math.max(0, Math.min(target.getTime() - Date.now(), MAX_WAIT_MINUTES * 60_000));
        const wokeEarly = await updates.waitForUpdate(delayMs);

        const now = formatNow();
        return wokeEarly
          ? `Resumed early — update arrived. It's now ${now}.`
          : `Reached target time. It's now ${now}.`;
      },
    },
  ];
}

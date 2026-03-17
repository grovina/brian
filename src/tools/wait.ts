import type { Tool } from "../types.js";
import type { UpdateQueue } from "../updates.js";

const MAX_WAIT_MS = 1440 * 60_000; // 24 hours

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
          "Pause execution. Specify any combination of conditions — the wait ends when the first one is met. Use minutes for a duration, datetime for a target time, and wake_on_events to resume when an external event (e.g. Slack message) arrives.",
        parameters: {
          type: "object",
          properties: {
            minutes: {
              type: "number",
              description: "Maximum minutes to wait (1–1440)",
            },
            datetime: {
              type: "string",
              description: "ISO 8601 datetime to wait until (e.g. 2025-03-14T09:00:00Z)",
            },
            wake_on_events: {
              type: "boolean",
              description: "If true, resume early when an external event arrives",
            },
            reason: {
              type: "string",
              description: "Why waiting is appropriate right now",
            },
          },
        },
      },
      async execute(input) {
        const { minutes, datetime, wake_on_events, reason } = input as {
          minutes?: number;
          datetime?: string;
          wake_on_events?: boolean;
          reason?: string;
        };

        let waitMs: number | undefined;

        if (typeof minutes === "number" && minutes > 0) {
          waitMs = Math.max(60_000, Math.min(minutes * 60_000, MAX_WAIT_MS));
        }

        if (typeof datetime === "string") {
          const target = new Date(datetime);
          if (!isNaN(target.getTime())) {
            const untilMs = Math.max(0, target.getTime() - Date.now());
            waitMs = waitMs !== undefined
              ? Math.min(waitMs, untilMs)
              : Math.min(untilMs, MAX_WAIT_MS);
          } else {
            return `Invalid datetime: ${datetime}`;
          }
        }

        if (waitMs === undefined && !wake_on_events) {
          return `No wait condition provided. It's now ${formatNow()}.`;
        }

        const effectiveMs = waitMs ?? MAX_WAIT_MS;

        if (wake_on_events) {
          const wokeEarly = await updates.waitForUpdate(effectiveMs);
          const now = formatNow();
          return wokeEarly
            ? `Resumed — event arrived. It's now ${now}.`
            : `Wait complete (no events). It's now ${now}.`;
        }

        await new Promise((resolve) => setTimeout(resolve, effectiveMs));
        return `Wait complete. It's now ${formatNow()}.`;
      },
    },
  ];
}

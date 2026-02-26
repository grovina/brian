import type { Tool } from "../types.js";

export const waitTool: Tool = {
  name: "wait",
  definition: {
    name: "wait",
    description:
      "Pause execution for a specified duration. Use when there's no immediate work to do. Choose an interval that reflects current priorities, expected responses, and time of day.",
    parameters: {
      type: "object",
      properties: {
        minutes: {
          type: "number",
          description: "How many minutes to wait",
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
    const { minutes, reason } = input as {
      minutes: number;
      reason?: string;
    };

    const clamped = Math.max(1, Math.min(minutes, 1440));
    await new Promise((resolve) => setTimeout(resolve, clamped * 60_000));

    const now = new Date().toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

    const msg = `Waited ${clamped} minutes. It's now ${now}.`;
    return reason ? `${msg} (${reason})` : msg;
  },
};

import {
  fetchMessages,
  sendMessage,
  resolveUser,
  formatMessage,
} from "../slack.js";
import type { Tool } from "./index.js";

export const slackReadTool: Tool = {
  name: "slack_read",
  definition: {
    name: "slack_read",
    description:
      "Read messages from the Slack channel. Returns messages in chronological order with timestamps and usernames. Pass `oldest` (a Slack message timestamp) to only get messages after that point.",
    input_schema: {
      type: "object" as const,
      properties: {
        oldest: {
          type: "string",
          description:
            "Slack message timestamp to read from. Only messages after this timestamp are returned.",
        },
        limit: {
          type: "number",
          description: "Maximum number of messages to return. Defaults to 50.",
        },
      },
      required: [],
    },
  },
  async execute(input) {
    const { oldest, limit } = input as { oldest?: string; limit?: number };
    const messages = await fetchMessages({ oldest, limit });

    if (messages.length === 0) return "No messages.";

    const lines: string[] = [];
    for (const msg of messages) {
      const userName = msg.user
        ? await resolveUser(msg.user)
        : msg.username || "bot";
      lines.push(formatMessage(msg, userName));
    }

    const latestTs = messages[messages.length - 1].ts;
    lines.push(`\n(latest message ts: ${latestTs})`);

    return lines.join("\n");
  },
};

export const slackPostTool: Tool = {
  name: "slack_post",
  definition: {
    name: "slack_post",
    description: "Post a message to the Slack channel.",
    input_schema: {
      type: "object" as const,
      properties: {
        text: {
          type: "string",
          description: "The message text to post. Supports Slack markdown.",
        },
      },
      required: ["text"],
    },
  },
  async execute(input) {
    const { text } = input as { text: string };
    await sendMessage(text);
    return "Message posted.";
  },
};

import {
  fetchMessages,
  sendMessage,
  addReaction,
  resolveUser,
  formatMessage,
  downloadImage,
  hasImages,
} from "../slack.js";
import type { Tool, ToolResult } from "./index.js";

export const slackReadTool: Tool = {
  name: "slack_read",
  definition: {
    name: "slack_read",
    description:
      "Read messages from a Slack channel. Pass `oldest` (a Slack message timestamp) to only get messages after that point.",
    parameters: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "The Slack channel ID to read from.",
        },
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
      required: ["channel"],
    },
  },
  async execute(input): Promise<ToolResult> {
    const { channel, oldest, limit } = input as {
      channel: string;
      oldest?: string;
      limit?: number;
    };
    const messages = await fetchMessages({ channel, oldest, limit });

    if (messages.length === 0) return "No messages.";

    const latestTs = messages[messages.length - 1].ts;
    const textLines: string[] = [];
    const images: { mimeType: string; data: string }[] = [];

    for (const msg of messages) {
      const userName = msg.user
        ? await resolveUser(msg.user)
        : msg.username || "bot";
      textLines.push(formatMessage(msg, userName));

      if (hasImages(msg)) {
        for (const file of msg.files ?? []) {
          const image = await downloadImage(file.url_private);
          if (image) {
            images.push(image);
          }
        }
      }
    }

    textLines.push(`\n(latest message ts: ${latestTs})`);
    return { text: textLines.join("\n"), images };
  },
};

export const slackPostTool: Tool = {
  name: "slack_post",
  definition: {
    name: "slack_post",
    description: "Post a message to a Slack channel.",
    parameters: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "The Slack channel ID to post to.",
        },
        text: {
          type: "string",
          description: "The message text to post. Supports Slack markdown.",
        },
      },
      required: ["channel", "text"],
    },
  },
  async execute(input) {
    const { channel, text } = input as { channel: string; text: string };
    await sendMessage(channel, text);
    return "Message posted.";
  },
};

export const slackReactTool: Tool = {
  name: "slack_react",
  definition: {
    name: "slack_react",
    description: "Add an emoji reaction to a Slack message.",
    parameters: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "The Slack channel ID where the message is.",
        },
        timestamp: {
          type: "string",
          description: "The timestamp of the message to react to.",
        },
        emoji: {
          type: "string",
          description:
            "The emoji name without colons (e.g. 'thumbsup', 'eyes', 'heart').",
        },
      },
      required: ["channel", "timestamp", "emoji"],
    },
  },
  async execute(input) {
    const { channel, timestamp, emoji } = input as {
      channel: string;
      timestamp: string;
      emoji: string;
    };
    await addReaction(channel, timestamp, emoji);
    return `Reacted with :${emoji}:`;
  },
};

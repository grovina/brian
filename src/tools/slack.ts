import Anthropic from "@anthropic-ai/sdk";
import {
  fetchMessages,
  sendMessage,
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
  async execute(input): Promise<ToolResult> {
    const { oldest, limit } = input as { oldest?: string; limit?: number };
    const messages = await fetchMessages({ oldest, limit });

    if (messages.length === 0) return "No messages.";

    const latestTs = messages[messages.length - 1].ts;

    // Build rich content blocks (text + images)
    const blocks: Anthropic.ToolResultBlockParam["content"] = [];
    const textLines: string[] = [];

    for (const msg of messages) {
      const userName = msg.user
        ? await resolveUser(msg.user)
        : msg.username || "bot";
      textLines.push(formatMessage(msg, userName));

      // Download and attach images inline
      if (hasImages(msg)) {
        for (const file of msg.files ?? []) {
          if (!(file.mimetype in { "image/jpeg": 1, "image/jpg": 1, "image/png": 1, "image/gif": 1, "image/webp": 1 })) continue;
          const image = await downloadImage(file.url_private);
          if (image) {
            blocks.push({
              type: "image",
              source: {
                type: "base64",
                media_type: image.mediaType,
                data: image.data,
              },
            } as Anthropic.ImageBlockParam);
          }
        }
      }
    }

    textLines.push(`\n(latest message ts: ${latestTs})`);
    blocks.unshift({ type: "text", text: textLines.join("\n") });

    return blocks;
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

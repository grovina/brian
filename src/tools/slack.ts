import type { Tool } from "../types.js";
import type { Slack } from "../slack.js";

export function slackTools(slack: Slack): Tool[] {
  return [
    {
      name: "slack_post",
      definition: {
        name: "slack_post",
        description:
          "Send a message to a Slack channel or reply in a thread. If thread_ts is provided, the message is posted as a thread reply.",
        parameters: {
          type: "object",
          properties: {
            channel: {
              type: "string",
              description: "Channel ID to post to",
            },
            text: {
              type: "string",
              description: "Message text",
            },
            thread_ts: {
              type: "string",
              description:
                "Thread timestamp to reply to (omit for a new top-level message)",
            },
          },
          required: ["channel", "text"],
        },
      },
      async execute(input) {
        const { channel, text, thread_ts } = input as {
          channel: string;
          text: string;
          thread_ts?: string;
        };
        const ts = await slack.postMessage(channel, text, thread_ts);
        return `Message sent (ts: ${ts})`;
      },
    },
    {
      name: "slack_react",
      definition: {
        name: "slack_react",
        description: "React to a Slack message with an emoji.",
        parameters: {
          type: "object",
          properties: {
            channel: {
              type: "string",
              description: "Channel ID containing the message",
            },
            timestamp: {
              type: "string",
              description: "Timestamp of the message to react to",
            },
            emoji: {
              type: "string",
              description: "Emoji name without colons (e.g. thumbsup)",
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
        await slack.addReaction(channel, timestamp, emoji);
        return `Reacted with :${emoji}:`;
      },
    },
  ];
}

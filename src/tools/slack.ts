import type { Tool } from "../types.js";
import type { Slack } from "../slack.js";

export function slackTools(slack: Slack): Tool[] {
  return [
    {
      name: "slack_send",
      definition: {
        name: "slack_send",
        description:
          "Send a Slack message. Use mode=reply with source_event_id to continue a conversation, or mode=channel with channel_id for a top-level channel message.",
        parameters: {
          type: "object",
          properties: {
            mode: {
              type: "string",
              enum: ["reply", "channel"],
              description: "Reply to an event thread or post top-level in a channel",
            },
            text: {
              type: "string",
              description: "Message text",
            },
            source_event_id: {
              type: "string",
              description: "Slack event_id to reply to when mode=reply",
            },
            channel_id: {
              type: "string",
              description: "Channel ID to post to when mode=channel",
            },
          },
          required: ["mode", "text"],
        },
      },
      async execute(input) {
        const { mode, text, source_event_id, channel_id } = input as {
          mode: "reply" | "channel";
          text: string;
          source_event_id?: string;
          channel_id?: string;
        };
        const result = await slack.sendMessage({
          mode,
          text,
          sourceEventId: source_event_id,
          channelId: channel_id,
        });
        return `Message sent (channel: ${result.channelId}, ts: ${result.ts}, thread_ts: ${result.threadTs ?? "none"})`;
      },
    },
    {
      name: "slack_react",
      definition: {
        name: "slack_react",
        description: "React to a Slack event with an emoji.",
        parameters: {
          type: "object",
          properties: {
            source_event_id: {
              type: "string",
              description: "Slack event_id to react to",
            },
            emoji: {
              type: "string",
              description: "Emoji name without colons (e.g. thumbsup)",
            },
          },
          required: ["source_event_id", "emoji"],
        },
      },
      async execute(input) {
        const { source_event_id, emoji } = input as {
          source_event_id: string;
          emoji: string;
        };
        await slack.addReactionByEvent(source_event_id, emoji);
        return `Reacted with :${emoji}:`;
      },
    },
  ];
}

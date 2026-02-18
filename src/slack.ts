import { config } from "./config.js";

const SLACK_API = "https://slack.com/api";

interface SlackMessage {
  ts: string;
  text?: string;
  user?: string;
  bot_id?: string;
}

async function api(method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.slack.botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack ${method}: ${data.error}`);
  }
  return data;
}

export async function getNewMessages(oldest: string): Promise<SlackMessage[]> {
  const data = await api("conversations.history", {
    channel: config.slack.channelId,
    oldest,
    limit: 100,
  });
  const messages: SlackMessage[] = data.messages ?? [];
  return messages.filter((m) => !m.bot_id && m.text).reverse();
}

export async function postMessage(text: string): Promise<void> {
  await api("chat.postMessage", {
    channel: config.slack.channelId,
    text,
    username: config.name,
  });
}

import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";

const SLACK_API = "https://slack.com/api";

interface SlackFile {
  mimetype: string;
  url_private: string;
  name?: string;
}

interface SlackMessage {
  ts: string;
  text?: string;
  user?: string;
  bot_id?: string;
  files?: SlackFile[];
}

export interface IncomingMessage {
  ts: string;
  user?: string;
  content: Anthropic.MessageParam["content"];
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

const SUPPORTED_IMAGE_TYPES: Record<string, Anthropic.Base64ImageSource["media_type"]> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/gif": "image/gif",
  "image/webp": "image/webp",
};

async function downloadImage(url: string): Promise<{ data: string; mediaType: Anthropic.Base64ImageSource["media_type"] } | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.slack.botToken}` },
    });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type")?.split(";")[0] ?? "";
    const mediaType = SUPPORTED_IMAGE_TYPES[contentType];
    if (!mediaType) return null;

    const buffer = await res.arrayBuffer();
    const data = Buffer.from(buffer).toString("base64");
    return { data, mediaType };
  } catch {
    return null;
  }
}

async function buildMessageContent(msg: SlackMessage): Promise<Anthropic.MessageParam["content"]> {
  const parts: Anthropic.ContentBlockParam[] = [];

  if (msg.text?.trim()) {
    parts.push({ type: "text", text: msg.text });
  }

  for (const file of msg.files ?? []) {
    const mediaType = SUPPORTED_IMAGE_TYPES[file.mimetype];
    if (!mediaType) continue;

    const image = await downloadImage(file.url_private);
    if (!image) continue;

    parts.push({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.data },
    });
  }

  // Fall back to plain text if nothing worked
  if (parts.length === 0) {
    return msg.text ?? "";
  }

  return parts;
}

export async function getNewMessages(oldest: string): Promise<IncomingMessage[]> {
  const data = await api("conversations.history", {
    channel: config.slack.channelId,
    oldest,
    limit: 100,
  });
  const messages: SlackMessage[] = data.messages ?? [];
  const filtered = messages.filter((m) => !m.bot_id && (m.text || m.files?.length)).reverse();

  const result: IncomingMessage[] = [];
  for (const msg of filtered) {
    const content = await buildMessageContent(msg);
    result.push({ ts: msg.ts, user: msg.user, content });
  }
  return result;
}

export async function postMessage(text: string): Promise<void> {
  await api("chat.postMessage", {
    channel: config.slack.channelId,
    text,
    username: config.name,
  });
}

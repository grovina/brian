import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";

const SLACK_API = "https://slack.com/api";

const SUPPORTED_IMAGE_TYPES: Record<string, Anthropic.Base64ImageSource["media_type"]> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/gif": "image/gif",
  "image/webp": "image/webp",
};

export interface SlackMessage {
  ts: string;
  text?: string;
  user?: string;
  username?: string;
  bot_id?: string;
  files?: { mimetype: string; url_private: string; name?: string }[];
}

export async function api(
  method: string,
  body: Record<string, unknown>
): Promise<any> {
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

const userCache = new Map<string, string>();

export async function resolveUser(userId: string): Promise<string> {
  const cached = userCache.get(userId);
  if (cached) return cached;

  try {
    const data = await api("users.info", { user: userId });
    const name =
      data.user?.profile?.display_name ||
      data.user?.real_name ||
      data.user?.name ||
      userId;
    userCache.set(userId, name);
    return name;
  } catch {
    return userId;
  }
}

export interface FetchMessagesOptions {
  oldest?: string;
  limit?: number;
}

export async function fetchMessages(
  options: FetchMessagesOptions = {}
): Promise<SlackMessage[]> {
  const params: Record<string, unknown> = {
    channel: config.slack.channelId,
    limit: options.limit ?? 50,
  };
  if (options.oldest) params.oldest = options.oldest;

  const data = await api("conversations.history", params);
  const messages: SlackMessage[] = data.messages ?? [];
  return messages.reverse();
}

export async function downloadImage(
  url: string
): Promise<{ data: string; mediaType: Anthropic.Base64ImageSource["media_type"] } | null> {
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

export function hasImages(msg: SlackMessage): boolean {
  return (msg.files ?? []).some((f) => f.mimetype in SUPPORTED_IMAGE_TYPES);
}

export function formatMessage(msg: SlackMessage, userName: string): string {
  const time = new Date(Number(msg.ts) * 1000).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const parts: string[] = [];
  if (msg.text?.trim()) parts.push(msg.text);

  const imageCount =
    msg.files?.filter((f) => f.mimetype in SUPPORTED_IMAGE_TYPES).length ?? 0;
  if (imageCount > 0)
    parts.push(`[${imageCount} image${imageCount > 1 ? "s" : ""} attached]`);

  const nonImageFiles =
    msg.files?.filter((f) => !(f.mimetype in SUPPORTED_IMAGE_TYPES)) ?? [];
  for (const file of nonImageFiles) {
    parts.push(`[file: ${file.name || "unnamed"}]`);
  }

  return `[${time}] ${userName}: ${parts.join(" ")}`;
}

export async function sendMessage(text: string): Promise<void> {
  await api("chat.postMessage", {
    channel: config.slack.channelId,
    text,
    username: config.name,
  });
}

export async function addReaction(timestamp: string, emoji: string): Promise<void> {
  await api("reactions.add", {
    channel: config.slack.channelId,
    timestamp,
    name: emoji,
  });
}

import { config } from "./config.js";

const SLACK_API = "https://slack.com/api";

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
]);

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

export function formatMessage(msg: SlackMessage, userName: string): string {
  const time = new Date(Number(msg.ts) * 1000).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const parts: string[] = [];
  if (msg.text?.trim()) parts.push(msg.text);

  const imageCount =
    msg.files?.filter((f) => IMAGE_TYPES.has(f.mimetype)).length ?? 0;
  if (imageCount > 0)
    parts.push(`[${imageCount} image${imageCount > 1 ? "s" : ""} attached]`);

  const nonImageFiles =
    msg.files?.filter((f) => !IMAGE_TYPES.has(f.mimetype)) ?? [];
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

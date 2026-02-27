import { WebClient } from "@slack/web-api";
import fs from "fs/promises";
import path from "path";
import type { ImageData } from "./types.js";
import { UpdateQueue, type Update } from "./updates.js";
import { formatErrorMessage, logError } from "./logs.js";

export interface SlackConfig {
  token: string;
  stateDir: string;
  pollIntervalMs?: number;
}

interface SlackMessage {
  eventId: string;
  user: string;
  userName: string;
  text: string;
  messageTs: string;
  threadTs?: string;
  channelId: string;
  channelName: string;
  isThreadReply: boolean;
  receivedAt: string;
  images?: ImageData[];
  attachmentNotes?: string[];
}

interface ChannelInfo {
  id: string;
  name: string;
  isDm: boolean;
}

interface SlackEventRoute {
  channelId: string;
  messageTs: string;
  threadTs?: string;
}

interface SlackHistoryInput {
  channelId: string;
  limit?: number;
  sinceTs?: string;
  beforeTs?: string;
  threadTs?: string;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const MAX_IMAGE_BYTES = 1024 * 1024; // 1MB
const MAX_SLACK_MESSAGES_PER_POLL = 120;
const MAX_SLACK_MESSAGE_TEXT_CHARS = 500;
const MAX_SLACK_UPDATE_CHARS = 32_000;
const MAX_HISTORY_LOOKUP_LIMIT = 100;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

function summarizeTextPayload(raw: string, maxLen = 220): string {
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function clampMessageText(text: string): string {
  if (text.length <= MAX_SLACK_MESSAGE_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_SLACK_MESSAGE_TEXT_CHARS)}... [truncated]`;
}

function parseSlackTs(ts: string): number {
  const value = Number.parseFloat(ts);
  return Number.isFinite(value) ? value : 0;
}

export class Slack {
  private client: WebClient;
  private stateDir: string;
  private pollIntervalMs: number;
  private cursors = new Map<string, string>();
  private users = new Map<string, string>();
  private channelNames = new Map<string, string>();
  private trackedThreads = new Map<string, string>(); // "channel:thread_ts" -> last_ts
  private eventRoutes = new Map<string, SlackEventRoute>();
  private polling = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private cursorsFile: string;

  constructor(config: SlackConfig) {
    this.client = new WebClient(config.token);
    this.stateDir = config.stateDir;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.cursorsFile = path.join(config.stateDir, "slack.json");
  }

  async sendMessage(input: {
    mode: "reply" | "channel";
    text: string;
    sourceEventId?: string;
    channelId?: string;
  }): Promise<{ ts: string; channelId: string; threadTs?: string }> {
    const text = input.text?.trim();
    if (!text) {
      throw new Error("text is required");
    }

    let channel = input.channelId;
    let threadTs: string | undefined;
    if (input.mode === "reply") {
      const eventId = input.sourceEventId?.trim();
      if (!eventId) {
        throw new Error("sourceEventId is required for reply mode");
      }
      const route = this.eventRoutes.get(eventId);
      if (!route) {
        throw new Error(
          `Unknown sourceEventId: ${eventId}. Use a recent event_id from Slack events.`
        );
      }
      channel = route.channelId;
      threadTs = route.threadTs ?? route.messageTs;
    } else if (!channel?.trim()) {
      throw new Error("channelId is required for channel mode");
    }

    const result = await this.client.chat.postMessage({
      channel,
      text,
      thread_ts: threadTs,
    });

    if (threadTs) {
      this.trackThread(channel, threadTs);
    } else if (result.ts) {
      this.trackThread(channel, result.ts);
    }

    return {
      ts: result.ts ?? "sent",
      channelId: channel,
      threadTs,
    };
  }

  async addReactionByEvent(
    sourceEventId: string,
    emoji: string
  ): Promise<void> {
    const route = this.eventRoutes.get(sourceEventId);
    if (!route) {
      throw new Error(
        `Unknown sourceEventId: ${sourceEventId}. Use a recent event_id from Slack events.`
      );
    }
    await this.client.reactions.add({
      channel: route.channelId,
      timestamp: route.messageTs,
      name: emoji.replace(/^:|:$/g, ""),
    });
  }

  async getHistory(input: SlackHistoryInput): Promise<{ text: string; images?: ImageData[] }> {
    const channelId = input.channelId?.trim();
    if (!channelId) {
      throw new Error("channelId is required");
    }

    const limit = Math.max(
      1,
      Math.min(MAX_HISTORY_LOOKUP_LIMIT, Math.floor(input.limit ?? 30))
    );
    const oldest = input.sinceTs?.trim() || undefined;
    const latest = input.beforeTs?.trim() || undefined;
    const threadTs = input.threadTs?.trim() || undefined;
    const channelName = await this.resolveChannelName(channelId);

    const fetched = threadTs
      ? await this.client.conversations.replies({
          channel: channelId,
          ts: threadTs,
          oldest,
          latest,
          limit,
          inclusive: false,
        })
      : await this.client.conversations.history({
          channel: channelId,
          oldest,
          latest,
          limit,
          inclusive: false,
        });

    const sourceMessages = fetched.messages ?? [];
    const slackMessages: SlackMessage[] = [];
    for (const msg of sourceMessages) {
      const subtype = (msg as { subtype?: string }).subtype;
      if (!msg.ts || !msg.text) continue;
      if (subtype === "channel_join" || subtype === "channel_leave") continue;

      const user = msg.user ?? "unknown";
      const userName = await this.resolveUser(user);
      const messageTs = msg.ts;
      const normalizedThreadTs = msg.thread_ts !== msg.ts ? msg.thread_ts : undefined;
      const eventId = this.eventId(channelId, messageTs);
      this.eventRoutes.set(eventId, {
        channelId,
        messageTs,
        threadTs: normalizedThreadTs,
      });
      this.pruneEventRoutes();

      const attachments = await this.extractImages(msg);
      slackMessages.push({
        eventId,
        user,
        userName,
        text: msg.text,
        messageTs,
        threadTs: normalizedThreadTs,
        channelId,
        channelName,
        isThreadReply: Boolean(normalizedThreadTs),
        receivedAt: new Date().toISOString(),
        images: attachments.images,
        attachmentNotes: attachments.notes,
      });
    }

    const ordered = slackMessages.sort(
      (a, b) => parseSlackTs(a.messageTs) - parseSlackTs(b.messageTs)
    );
    const lines: string[] = [];
    const events: string[] = [];
    const images: ImageData[] = [];
    for (const msg of ordered) {
      events.push(
        JSON.stringify({
          event_id: msg.eventId,
          channel_id: msg.channelId,
          channel_name: msg.channelName,
          message_ts: msg.messageTs,
          thread_ts: msg.threadTs,
          is_thread_reply: msg.isThreadReply,
          user_id: msg.user,
          user_name: msg.userName,
          text: clampMessageText(msg.text),
          received_at: msg.receivedAt,
        })
      );

      const time = this.formatTs(msg.messageTs);
      const prefix = msg.threadTs ? "  ↳ " : "- ";
      lines.push(
        `${prefix}${msg.userName} (${time}) [event_id=${msg.eventId}]: ${clampMessageText(msg.text)}`
      );

      if (msg.images) images.push(...msg.images);
      if (msg.attachmentNotes && msg.attachmentNotes.length > 0) {
        for (const note of msg.attachmentNotes) {
          lines.push(`    ${note}`);
        }
      }
    }

    const scopeLabel = threadTs ? `thread ${threadTs}` : `channel #${channelName}`;
    const header = `Slack history for ${scopeLabel} (channel ${channelId}, ${ordered.length} messages)`;
    const text = [
      `**${header}**`,
      "",
      "**Slack events (JSONL):**",
      ...events,
      "",
      "**Slack history:**",
      ...lines,
    ].join("\n");

    return {
      text,
      images: images.length > 0 ? images : undefined,
    };
  }

  startPolling(updates: UpdateQueue): void {
    if (this.polling) return;
    this.polling = true;
    this.pollLoop(updates);
  }

  stopPolling(): void {
    this.polling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  trackThread(channel: string, threadTs: string): void {
    const key = `${channel}:${threadTs}`;
    if (!this.trackedThreads.has(key)) {
      this.trackedThreads.set(key, threadTs);
    }
  }

  private async pollLoop(updates: UpdateQueue): Promise<void> {
    await this.loadCursors();

    while (this.polling) {
      try {
        await this.poll(updates);
      } catch (err) {
        logError(`slack poll error: ${formatErrorMessage(err)}`, { error: err });
      }

      if (!this.polling) break;
      await new Promise<void>((resolve) => {
        this.pollTimer = setTimeout(resolve, this.pollIntervalMs);
      });
    }
  }

  private async poll(updates: UpdateQueue): Promise<void> {
    const channels = await this.getChannels();
    if (channels.length === 0) return;

    if (this.cursors.size === 0) {
      for (const channel of channels) {
        await this.seedChannelCursor(channel.id);
      }
      await this.saveCursors();
      return;
    }

    const newMessages: SlackMessage[] = [];

    for (const channel of channels) {
      if (!this.cursors.has(channel.id)) {
        await this.seedChannelCursor(channel.id);
        continue;
      }
      const messages = await this.getNewMessages(channel);
      newMessages.push(...messages);
    }

    const threadMessages = await this.getThreadUpdates();
    newMessages.push(...threadMessages);

    if (newMessages.length === 0) return;

    // Keep the newest messages first, then restore chronological order for readability.
    const keptMessages = [...newMessages]
      .sort((a, b) => parseSlackTs(b.messageTs) - parseSlackTs(a.messageTs))
      .slice(0, MAX_SLACK_MESSAGES_PER_POLL)
      .sort((a, b) => parseSlackTs(a.messageTs) - parseSlackTs(b.messageTs));
    const droppedMessages = newMessages.length - keptMessages.length;

    const grouped = this.groupByChannel(keptMessages);
    const lines: string[] = [];
    const events: string[] = [];
    const allImages: ImageData[] = [];

    for (const msg of keptMessages) {
      events.push(
        JSON.stringify({
          event_id: msg.eventId,
          channel_id: msg.channelId,
          channel_name: msg.channelName,
          message_ts: msg.messageTs,
          thread_ts: msg.threadTs,
          is_thread_reply: msg.isThreadReply,
          user_id: msg.user,
          user_name: msg.userName,
          text: clampMessageText(msg.text),
          received_at: msg.receivedAt,
        })
      );
    }

    for (const [channelName, msgs] of grouped) {
      lines.push(`**#${channelName}:**`);
      for (const msg of msgs) {
        const time = this.formatTs(msg.messageTs);
        const prefix = msg.threadTs ? "  ↳ " : "- ";
        lines.push(
          `${prefix}${msg.userName} (${time}) [event_id=${msg.eventId}]: ${clampMessageText(msg.text)}`
        );
        if (msg.images) allImages.push(...msg.images);
        if (msg.attachmentNotes && msg.attachmentNotes.length > 0) {
          for (const note of msg.attachmentNotes) {
            lines.push(`    ${note}`);
          }
        }
      }
    }

    const metadata: string[] = [];
    if (droppedMessages > 0) {
      metadata.push(
        `[slack updates truncated: kept latest ${keptMessages.length} of ${newMessages.length} messages]`
      );
    }

    let content = [
      ...metadata,
      "**Slack events (JSONL):**",
      ...events,
      "",
      "**Slack updates:**",
      ...lines,
    ].join("\n");

    if (content.length > MAX_SLACK_UPDATE_CHARS) {
      content =
        `[slack updates truncated before this point: kept latest ${MAX_SLACK_UPDATE_CHARS} chars]\n` +
        content.slice(-MAX_SLACK_UPDATE_CHARS);
    }

    updates.push({
      source: "slack",
      content,
      images: allImages.length > 0 ? allImages : undefined,
      timestamp: new Date(),
    });

    await this.saveCursors();
  }

  private async seedChannelCursor(channelId: string): Promise<void> {
    if (this.cursors.has(channelId)) return;
    try {
      const result = await this.client.conversations.history({
        channel: channelId,
        limit: 1,
      });
      const latestTs = result.messages?.[0]?.ts;
      if (latestTs) {
        this.cursors.set(channelId, latestTs);
        return;
      }
    } catch {
      // channel might not be accessible
    }
    const nowTs = (Date.now() / 1000).toFixed(6);
    this.cursors.set(channelId, nowTs);
  }

  private async getChannels(): Promise<ChannelInfo[]> {
    const channels: ChannelInfo[] = [];
    let cursor: string | undefined;

    do {
      const result = await this.client.conversations.list({
        types: "public_channel,private_channel,mpim,im",
        exclude_archived: true,
        limit: 200,
        cursor,
      });

      for (const ch of result.channels ?? []) {
        if (!ch.id || !ch.is_member) continue;
        const channelName = ch.name ?? ch.id;
        this.channelNames.set(ch.id, channelName);
        channels.push({
          id: ch.id,
          name: channelName,
          isDm: ch.is_im ?? false,
        });
      }

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    return channels;
  }

  private async getNewMessages(channel: ChannelInfo): Promise<SlackMessage[]> {
    const oldest = this.cursors.get(channel.id);
    const messages: SlackMessage[] = [];

    try {
      const result = await this.client.conversations.history({
        channel: channel.id,
        oldest,
        limit: 50,
      });

      for (const msg of result.messages ?? []) {
        if (!msg.ts || !msg.text) continue;
        if (msg.subtype === "channel_join" || msg.subtype === "channel_leave")
          continue;
        if (oldest && msg.ts === oldest) continue;

        const user = msg.user ?? "unknown";
        const userName = await this.resolveUser(user);
        const messageTs = msg.ts;
        const threadTs = msg.thread_ts !== msg.ts ? msg.thread_ts : undefined;
        const channelName = channel.isDm ? userName : channel.name;
        const eventId = this.eventId(channel.id, messageTs);
        this.eventRoutes.set(eventId, {
          channelId: channel.id,
          messageTs,
          threadTs,
        });
        this.pruneEventRoutes();

        const attachments = await this.extractImages(msg);
        messages.push({
          eventId,
          user,
          userName,
          text: msg.text,
          messageTs,
          threadTs,
          channelId: channel.id,
          channelName,
          isThreadReply: Boolean(threadTs),
          receivedAt: new Date().toISOString(),
          images: attachments.images,
          attachmentNotes: attachments.notes,
        });

        if (msg.thread_ts && msg.reply_count) {
          this.trackThread(channel.id, msg.thread_ts);
        }
      }

      if (result.messages?.length) {
        const latest = result.messages[0]?.ts;
        if (latest) this.cursors.set(channel.id, latest);
      }
    } catch {
      // channel might not be accessible
    }

    return messages;
  }

  private async getThreadUpdates(): Promise<SlackMessage[]> {
    const messages: SlackMessage[] = [];

    for (const [key, lastTs] of this.trackedThreads) {
      const [channel, threadTs] = key.split(":");
      if (!channel || !threadTs) continue;

      try {
        const result = await this.client.conversations.replies({
          channel,
          ts: threadTs,
          oldest: lastTs,
          limit: 50,
        });

        for (const msg of result.messages ?? []) {
          if (!msg.ts || !msg.text) continue;
          if (msg.ts === lastTs || msg.ts === threadTs) continue;

          const user = msg.user ?? "unknown";
          const userName = await this.resolveUser(user);
          const messageTs = msg.ts;
          const eventId = this.eventId(channel, messageTs);
          this.eventRoutes.set(eventId, {
            channelId: channel,
            messageTs,
            threadTs,
          });
          this.pruneEventRoutes();

          const attachments = await this.extractImages(msg);
          messages.push({
            eventId,
            user,
            userName,
            text: msg.text,
            messageTs,
            threadTs,
            channelId: channel,
            channelName: this.channelNames.get(channel) ?? channel,
            isThreadReply: true,
            receivedAt: new Date().toISOString(),
            images: attachments.images,
            attachmentNotes: attachments.notes,
          });
        }

        const latest = result.messages?.at(-1)?.ts;
        if (latest && latest !== lastTs) {
          this.trackedThreads.set(key, latest);
        }
      } catch {
        // thread might be inaccessible
      }
    }

    return messages;
  }

  private async extractImages(
    msg: any
  ): Promise<{ images?: ImageData[]; notes: string[] }> {
    const images: ImageData[] = [];
    const notes: string[] = [];

    for (const file of msg.files ?? []) {
      if (!file.mimetype?.startsWith("image/")) continue;
      if ((file.size ?? 0) > MAX_IMAGE_BYTES * 5) continue;

      const label = file.name ?? file.id ?? "image";
      const url = file.url_private_download ?? file.url_private;
      if (!url) {
        notes.push(`- attachment ${label} unavailable (missing private download URL)`);
        continue;
      }

      let response: Response;
      try {
        response = await fetch(url, {
          headers: { Authorization: `Bearer ${this.client.token}` },
        });
      } catch (err) {
        notes.push(`- attachment ${label} unavailable (${(err as Error).message})`);
        continue;
      }

      if (!response.ok) {
        notes.push(
          `- attachment ${label} unavailable (download failed: HTTP ${response.status})`
        );
        continue;
      }

      const responseMime =
        response.headers.get("content-type")?.split(";")[0].trim() ?? "";
      if (responseMime && !responseMime.startsWith("image/")) {
        let payloadSnippet = "";
        if (responseMime.startsWith("text/")) {
          const body = await response.text();
          const summary = summarizeTextPayload(body);
          if (summary) payloadSnippet = ` | payload: ${summary}`;
        }
        notes.push(
          `- attachment ${label} unavailable (download returned ${responseMime}, expected image${payloadSnippet})`
        );
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) {
        notes.push(`- attachment ${label} unavailable (empty payload)`);
        continue;
      }
      if (buffer.length > MAX_IMAGE_BYTES) {
        notes.push(
          `- attachment ${label} unavailable (image too large: ${Math.round(buffer.length / 1024)}KB)`
        );
        continue;
      }

      const maybeHtml = buffer
        .subarray(0, 80)
        .toString("utf8")
        .trimStart()
        .toLowerCase();
      if (
        maybeHtml.startsWith("<!doctype html") ||
        maybeHtml.startsWith("<html") ||
        maybeHtml.startsWith("<a href")
      ) {
        const summary = summarizeTextPayload(buffer.toString("utf8"));
        const payloadSnippet = summary ? ` | payload: ${summary}` : "";
        notes.push(
          `- attachment ${label} unavailable (payload is HTML, expected image${payloadSnippet})`
        );
        continue;
      }

      const effectiveMime =
        responseMime && responseMime.startsWith("image/")
          ? responseMime
          : (file.mimetype ?? "").split(";")[0].trim();
      if (!ALLOWED_IMAGE_MIME_TYPES.has(effectiveMime)) {
        notes.push(
          `- attachment ${label} unavailable (unsupported image type ${effectiveMime || "unknown"})`
        );
        continue;
      }

      images.push({
        mimeType: effectiveMime,
        data: buffer.toString("base64"),
      });
    }

    return { images: images.length > 0 ? images : undefined, notes };
  }

  private async resolveUser(userId: string): Promise<string> {
    if (this.users.has(userId)) return this.users.get(userId)!;

    try {
      const result = await this.client.users.info({ user: userId });
      const name =
        result.user?.profile?.display_name ||
        result.user?.real_name ||
        result.user?.name ||
        userId;
      this.users.set(userId, name);
      return name;
    } catch {
      return userId;
    }
  }

  private async resolveChannelName(channelId: string): Promise<string> {
    const cached = this.channelNames.get(channelId);
    if (cached) return cached;
    try {
      const result = await this.client.conversations.info({ channel: channelId });
      const name = result.channel?.name ?? channelId;
      this.channelNames.set(channelId, name);
      return name;
    } catch {
      return channelId;
    }
  }

  private groupByChannel(
    messages: SlackMessage[]
  ): Map<string, SlackMessage[]> {
    const grouped = new Map<string, SlackMessage[]>();
    for (const msg of messages) {
      const group = grouped.get(msg.channelName) ?? [];
      group.push(msg);
      grouped.set(msg.channelName, group);
    }
    return grouped;
  }

  private formatTs(ts: string): string {
    const date = new Date(parseFloat(ts) * 1000);
    return date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  private eventId(channelId: string, messageTs: string): string {
    return `slk_${channelId}_${messageTs.replace(/\./g, "_")}`;
  }

  private pruneEventRoutes(max = 5000): void {
    if (this.eventRoutes.size <= max) return;
    const extra = this.eventRoutes.size - max;
    let removed = 0;
    for (const key of this.eventRoutes.keys()) {
      this.eventRoutes.delete(key);
      removed++;
      if (removed >= extra) break;
    }
  }

  private async loadCursors(): Promise<void> {
    try {
      const data = await fs.readFile(this.cursorsFile, "utf-8");
      const parsed = JSON.parse(data);
      if (parsed.channels) {
        this.cursors = new Map(Object.entries(parsed.channels));
      }
      if (parsed.threads) {
        this.trackedThreads = new Map(Object.entries(parsed.threads));
      }
      if (parsed.events) {
        this.eventRoutes = new Map(
          Object.entries(parsed.events) as Array<[string, SlackEventRoute]>
        );
      }
    } catch {
      // fresh start
    }
  }

  private async saveCursors(): Promise<void> {
    try {
      await fs.writeFile(
        this.cursorsFile,
        JSON.stringify({
          channels: Object.fromEntries(this.cursors),
          threads: Object.fromEntries(this.trackedThreads),
          events: Object.fromEntries(this.eventRoutes),
        })
      );
    } catch (err) {
      logError(`slack failed to save cursors: ${formatErrorMessage(err)}`, {
        error: err,
      });
    }
  }
}

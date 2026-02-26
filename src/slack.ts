import { WebClient } from "@slack/web-api";
import fs from "fs/promises";
import path from "path";
import type { ImageData } from "./types.js";
import { UpdateQueue, type Update } from "./updates.js";

export interface SlackConfig {
  token: string;
  stateDir: string;
  pollIntervalMs?: number;
}

interface SlackMessage {
  user: string;
  text: string;
  ts: string;
  threadTs?: string;
  channel: string;
  channelName: string;
  images?: ImageData[];
}

interface ChannelInfo {
  id: string;
  name: string;
  isDm: boolean;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const MAX_IMAGE_BYTES = 1024 * 1024; // 1MB

export class Slack {
  private client: WebClient;
  private stateDir: string;
  private pollIntervalMs: number;
  private cursors = new Map<string, string>();
  private users = new Map<string, string>();
  private trackedThreads = new Map<string, string>(); // "channel:thread_ts" -> last_ts
  private polling = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private cursorsFile: string;

  constructor(config: SlackConfig) {
    this.client = new WebClient(config.token);
    this.stateDir = config.stateDir;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.cursorsFile = path.join(config.stateDir, "slack-cursors.json");
  }

  async postMessage(
    channel: string,
    text: string,
    threadTs?: string
  ): Promise<string> {
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

    return result.ts ?? "sent";
  }

  async addReaction(
    channel: string,
    timestamp: string,
    emoji: string
  ): Promise<void> {
    await this.client.reactions.add({
      channel,
      timestamp,
      name: emoji.replace(/^:|:$/g, ""),
    });
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
        console.error("[slack] poll error:", err);
      }

      if (!this.polling) break;
      await new Promise<void>((resolve) => {
        this.pollTimer = setTimeout(resolve, this.pollIntervalMs);
      });
    }
  }

  private async poll(updates: UpdateQueue): Promise<void> {
    const channels = await this.getChannels();
    const newMessages: SlackMessage[] = [];

    for (const channel of channels) {
      const messages = await this.getNewMessages(channel);
      newMessages.push(...messages);
    }

    const threadMessages = await this.getThreadUpdates();
    newMessages.push(...threadMessages);

    if (newMessages.length === 0) return;

    const grouped = this.groupByChannel(newMessages);
    const lines: string[] = [];
    const allImages: ImageData[] = [];

    for (const [channelName, msgs] of grouped) {
      lines.push(`**#${channelName}:**`);
      for (const msg of msgs) {
        const userName = await this.resolveUser(msg.user);
        const time = this.formatTs(msg.ts);
        const prefix = msg.threadTs ? "  ↳ " : "- ";
        lines.push(`${prefix}${userName} (${time}): ${msg.text}`);
        if (msg.images) allImages.push(...msg.images);
      }
    }

    updates.push({
      source: "slack",
      content: `**Slack updates:**\n${lines.join("\n")}`,
      images: allImages.length > 0 ? allImages : undefined,
      timestamp: new Date(),
    });

    await this.saveCursors();
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
        channels.push({
          id: ch.id,
          name: ch.name ?? ch.id,
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

        const images = await this.extractImages(msg);
        messages.push({
          user: msg.user ?? "unknown",
          text: msg.text,
          ts: msg.ts,
          threadTs: msg.thread_ts !== msg.ts ? msg.thread_ts : undefined,
          channel: channel.id,
          channelName: channel.isDm
            ? await this.resolveUser(msg.user ?? "unknown")
            : channel.name,
          images,
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

          const images = await this.extractImages(msg);
          messages.push({
            user: msg.user ?? "unknown",
            text: msg.text,
            ts: msg.ts,
            threadTs,
            channel,
            channelName: channel,
            images,
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

  private async extractImages(msg: any): Promise<ImageData[] | undefined> {
    const images: ImageData[] = [];

    for (const file of msg.files ?? []) {
      if (!file.mimetype?.startsWith("image/")) continue;
      if ((file.size ?? 0) > MAX_IMAGE_BYTES * 5) continue;

      const url = file.url_private;
      if (!url) continue;

      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${this.client.token}` },
        });
        if (!response.ok) continue;

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > MAX_IMAGE_BYTES) continue;

        images.push({
          mimeType: file.mimetype,
          data: buffer.toString("base64"),
        });
      } catch {
        // skip undownloadable images
      }
    }

    return images.length > 0 ? images : undefined;
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
        })
      );
    } catch (err) {
      console.error("[slack] failed to save cursors:", err);
    }
  }
}

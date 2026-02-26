import { formatTime, type ImageData } from "./types.js";

export interface Update {
  source: string;
  content: string;
  images?: ImageData[];
  timestamp: Date;
}

export class UpdateQueue {
  private pending: Update[] = [];

  push(update: Update): void {
    this.pending.push(update);
  }

  drain(): Update[] {
    const updates = this.pending;
    this.pending = [];
    return updates;
  }

}

export function formatUpdates(updates: Update[]): string {
  if (updates.length === 0) return "";

  const time = formatTime();

  const body = updates.map((u) => u.content).join("\n\n");
  return `[${time}]\n\n${body}`;
}

export function collectImages(updates: Update[]): ImageData[] {
  return updates.flatMap((u) => u.images ?? []);
}

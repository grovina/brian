import { formatTime, type ImageData } from "./types.js";

export interface Update {
  source: string;
  content: string;
  images?: ImageData[];
  timestamp: Date;
}

export class UpdateQueue {
  private pending: Update[] = [];
  private waitResolvers: Array<() => void> = [];

  push(update: Update): void {
    this.pending.push(update);
    for (const resolve of this.waitResolvers) {
      resolve();
    }
    this.waitResolvers = [];
  }

  drain(): Update[] {
    const updates = this.pending;
    this.pending = [];
    return updates;
  }

  /**
   * Returns a promise that resolves to true if an update arrives before
   * the timeout, or false if the timeout expires first.
   */
  waitForUpdate(timeoutMs: number): Promise<boolean> {
    if (this.pending.length > 0) return Promise.resolve(true);

    return new Promise<boolean>((resolve) => {
      const onUpdate = () => {
        clearTimeout(timer);
        resolve(true);
      };

      const timer = setTimeout(() => {
        const idx = this.waitResolvers.indexOf(onUpdate);
        if (idx >= 0) this.waitResolvers.splice(idx, 1);
        resolve(false);
      }, timeoutMs);

      this.waitResolvers.push(onUpdate);
    });
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

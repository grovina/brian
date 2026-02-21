import type { WakeStrategy, WakeResult } from "../types.js";

export interface PeriodicWakeConfig {
  intervalMinutes?: number;
  maxIntervalMinutes?: number;
  backoffMultiplier?: number;
}

export class PeriodicWake implements WakeStrategy {
  private minIntervalMs: number;
  private maxIntervalMs: number;
  private backoffMultiplier: number;
  private currentIntervalMs: number;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: PeriodicWakeConfig = {}) {
    this.minIntervalMs = (config.intervalMinutes ?? 3) * 60_000;
    this.maxIntervalMs = (config.maxIntervalMinutes ?? 60) * 60_000;
    this.backoffMultiplier = config.backoffMultiplier ?? 1.5;
    this.currentIntervalMs = this.minIntervalMs;
  }

  async start(handler: () => Promise<WakeResult>): Promise<void> {
    this.running = true;

    // Run immediately on start
    await this.runAndSchedule(handler);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async runAndSchedule(
    handler: () => Promise<WakeResult>
  ): Promise<void> {
    while (this.running) {
      try {
        const result = await handler();

        if (result.nextWakeMinutes !== undefined) {
          this.currentIntervalMs = result.nextWakeMinutes * 60_000;
        } else if (result.active) {
          this.currentIntervalMs = this.minIntervalMs;
        } else {
          this.currentIntervalMs = Math.min(
            Math.round(this.currentIntervalMs * this.backoffMultiplier),
            this.maxIntervalMs
          );
        }
      } catch (err) {
        console.error("Wake handler error:", err);
        this.currentIntervalMs = this.minIntervalMs;
      }

      if (!this.running) break;

      const intervalSec = Math.round(this.currentIntervalMs / 1000);
      console.log(`Next wake in ${intervalSec}s`);

      await new Promise<void>((resolve) => {
        this.timer = setTimeout(resolve, this.currentIntervalMs);
      });
    }
  }
}

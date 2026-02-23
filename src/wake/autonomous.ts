import type { WakeStrategy, Tool } from "../types.js";

export interface AutonomousWakeConfig {
  defaultIntervalMinutes?: number;
}

export class AutonomousWake implements WakeStrategy {
  private defaultIntervalMs: number;
  private nextWakeMs: number;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: AutonomousWakeConfig = {}) {
    this.defaultIntervalMs = (config.defaultIntervalMinutes ?? 15) * 60_000;
    this.nextWakeMs = this.defaultIntervalMs;
  }

  tools(): Tool[] {
    return [
      {
        name: "done",
        definition: {
          name: "done",
          description:
            "End this wake cycle and set when to wake up next based on what's happening, time of day, pending tasks, etc.",
          parameters: {
            type: "object",
            properties: {
              minutes: {
                type: "number",
                description: "Minutes until next wake",
              },
              reason: {
                type: "string",
                description: "Why this interval",
              },
            },
            required: ["minutes"],
          },
        },
        execute: async (input) => {
          const { minutes, reason } = input as {
            minutes: number;
            reason?: string;
          };
          this.nextWakeMs = minutes * 60_000;
          const msg = `Next wake in ${minutes} minutes`;
          return reason ? `${msg} (${reason})` : msg;
        },
      },
    ];
  }

  promptSection(): string {
    return "Call done(minutes) when you're finished to set when you'll wake up next. Consider time of day, pending work, expected responses, and anything else relevant to decide the interval.";
  }

  async start(handler: () => Promise<void>): Promise<void> {
    this.running = true;
    await this.runAndSchedule(handler);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async runAndSchedule(handler: () => Promise<void>): Promise<void> {
    while (this.running) {
      this.nextWakeMs = this.defaultIntervalMs;

      try {
        await handler();
      } catch (err) {
        console.error("Wake handler error:", err);
      }

      if (!this.running) break;

      const intervalSec = Math.round(this.nextWakeMs / 1000);
      console.log(`Next wake in ${intervalSec}s`);

      await new Promise<void>((resolve) => {
        this.timer = setTimeout(resolve, this.nextWakeMs);
      });
    }
  }
}

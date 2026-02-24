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
        name: "sleep_until",
        definition: {
          name: "sleep_until",
          description:
            "End this wake cycle and schedule the next wake time in minutes based on current priorities, pending work, and expected updates.",
          parameters: {
            type: "object",
            properties: {
              minutes: {
                type: "number",
                description: "Minutes to sleep before the next wake cycle",
              },
              reason: {
                type: "string",
                description: "Why this sleep interval is appropriate right now",
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
    return "Call sleep_until(minutes) to end the current wake cycle and schedule the next one. Choose an interval that matches urgency, pending work, expected responses, and time of day.";
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

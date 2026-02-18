import { homedir } from "os";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

const HOME = homedir();

export const config = {
  name: optional("BRIAN_NAME", "brian"),
  pollIntervalSeconds: Number(optional("POLL_INTERVAL_SECONDS", "30")),
  slack: {
    botToken: required("SLACK_BOT_TOKEN"),
    channelId: required("SLACK_CHANNEL_ID"),
  },
  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
    model: optional("BRIAN_MODEL", "claude-sonnet-4-5"),
  },
  github: {
    token: optional("GITHUB_TOKEN", ""),
  },
  heartbeat: {
    intervalMinutes: Number(optional("HEARTBEAT_INTERVAL_MINUTES", "30")),
    activeHoursStart: optional("HEARTBEAT_ACTIVE_HOURS_START", "08:00"),
    activeHoursEnd: optional("HEARTBEAT_ACTIVE_HOURS_END", "22:00"),
  },
  paths: {
    workspace: optional("BRIAN_WORKSPACE", `${HOME}/.brian/workspace`),
    secrets: optional("SECRETS_DIR", `${HOME}/secrets`),
    projects: optional("PROJECTS_DIR", `${HOME}/projects`),
  },
} as const;

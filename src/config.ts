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

export const config = {
  telegram: {
    botToken: required("TELEGRAM_BOT_TOKEN"),
    ownerId: Number(required("TELEGRAM_OWNER_ID")),
  },
  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
    model: optional("BRIAN_MODEL", "claude-sonnet-4-20250514"),
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
    workspace: new URL("../workspace", import.meta.url).pathname,
    secrets: process.env.SECRETS_DIR || `${process.env.HOME}/secrets`,
    projects: process.env.PROJECTS_DIR || `${process.env.HOME}/projects`,
  },
} as const;

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
  wakeIntervalMinutes: Number(optional("WAKE_INTERVAL_MINUTES", "3")),
  slack: {
    token: required("SLACK_TOKEN"),
  },
  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
    model: optional("BRIAN_MODEL", "claude-sonnet-4-6"),
  },
  github: {
    token: optional("GITHUB_TOKEN", ""),
    org: optional("GITHUB_ORG", ""),
  },
  paths: {
    workspace: optional("BRIAN_WORKSPACE", `${HOME}/.brian/workspace`),
    secrets: optional("SECRETS_DIR", `${HOME}/secrets`),
    projects: optional("PROJECTS_DIR", `${HOME}/projects`),
  },
} as const;

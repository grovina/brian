# Brian

An autonomous AI worker that runs as a persistent process, communicates via Slack, and can modify its own code. Designed to operate as part of a team of brians — independent agents sharing the same codebase, each with their own identity and memory.

## Architecture

Brian is a polling loop. Every 30 seconds it checks Slack for new messages, processes them sequentially, and periodically runs through a heartbeat checklist. When there's nothing to do, it idles. Cost is proportional to actual work.

- **Git** is the persistent source of truth (code, docs, memory)
- **Slack** is the ephemeral communication layer
- **Anthropic Claude** is the brain

## Setup

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps):
   - Enable Socket Mode (to get an app-level token — not used, but required for bot setup)
   - Add Bot Token Scopes: `chat:write`, `channels:history`, `channels:read`
   - Install to workspace
   - Create a channel for the brian and note the channel ID

2. Configure environment:
   ```bash
   cp .env.example .env
   # Fill in SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, ANTHROPIC_API_KEY, GITHUB_TOKEN
   ```

3. Deploy:
   ```bash
   ./please deploy gcp              # GCP VM
   ./please deploy local user@host  # Local/home server
   ```

## Development

```bash
npm install
npm run dev          # Run with tsx
npm run build        # Compile TypeScript
npm start            # Run compiled output
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `BRIAN_NAME` | No | Identity (default: `brian`) — used in Slack and git |
| `SLACK_BOT_TOKEN` | Yes | Slack bot token (`xoxb-...`) |
| `SLACK_CHANNEL_ID` | Yes | Slack channel to monitor |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `GITHUB_TOKEN` | No | GitHub personal access token |
| `BRIAN_MODEL` | No | LLM model (default: `claude-sonnet-4-5`) |
| `POLL_INTERVAL_SECONDS` | No | How often to check Slack (default: `30`) |
| `HEARTBEAT_INTERVAL_MINUTES` | No | Proactive check interval (default: `30`) |

## Multiple Brians

Each brian is an independent process with its own `BRIAN_NAME` and `SLACK_CHANNEL_ID`. They share the same Slack bot token and codebase. Deploy multiple instances with different `.env` files.

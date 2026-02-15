# Brian

A self-hosted AI agent that acts as a personal developer, assistant, and manager. Runs as a persistent process on a VM, communicates via Telegram, executes tasks using shell tools, and can modify its own code.

## Setup

```bash
./deploy.sh \
  --telegram-token "BOT_TOKEN" \
  --anthropic-key "sk-ant-..." \
  --github-token "ghp_..." \
  --owner-telegram-id "123456789"
```

## Development

```bash
npm install
npm run dev          # Run with tsx (hot reload)
npm run build        # Compile TypeScript
npm start            # Run compiled output
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot token from @BotFather |
| `TELEGRAM_OWNER_ID` | Yes | Telegram user ID of the owner |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `GITHUB_TOKEN` | No | GitHub personal access token |
| `BRIAN_MODEL` | No | LLM model (default: `claude-sonnet-4-20250514`) |
| `HEARTBEAT_INTERVAL_MINUTES` | No | Heartbeat interval (default: 30) |
| `HEARTBEAT_ACTIVE_HOURS_START` | No | Heartbeat active window start (default: `08:00`) |
| `HEARTBEAT_ACTIVE_HOURS_END` | No | Heartbeat active window end (default: `22:00`) |

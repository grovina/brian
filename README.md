# Brian

The kernel for autonomous AI coworkers. Clone it, give it two tokens, and you have an independent agent that communicates on Slack, manages code on GitHub, and can improve itself.

Brian is not a framework, not a library — it's a running process. A coworker that happens to be software.

## Two-Repo Model

Brian is designed around a clean separation:

**This repo (the kernel)** — the strong base that any brian needs:
- Agent loop (LLM + tool execution, conversation state)
- Core tools: `bash`, `files`, `memory`, `self_deploy`
- Slack + GitHub MCP servers (shipped in `mcp/`)
- MCP client for loading additional tools
- Memory system, system prompt builder, polling loop

**`{org}/brian-config` (extensions)** — org-specific configuration:
- Additional MCP servers (Linear, Chrome DevTools, etc.)
- Custom instructions and persona
- VM setup and deployment scripts
- Anything specific to the team

The first brian at a new org creates the config repo as part of onboarding (see `docs/onboarding.md`).

## Quick Start

Two tokens. That's all brian needs.

```bash
export BRIAN_NAME=pickle-1
export SLACK_TOKEN=xoxp-...          # User token (or xoxb- bot token)
export SLACK_CHANNEL_ID=C0123456789
export ANTHROPIC_API_KEY=sk-ant-...
export GITHUB_TOKEN=ghp_...
export GITHUB_ORG=klauvi             # Optional — for config repo creation

npm install && npm run build && npm start
```

Brian boots up, connects to Slack and GitHub via MCP, loads any user MCP servers from `~/.brian/mcp-servers.json`, and starts polling for messages.

## Architecture

```
src/
├── main.ts            # Polling loop — checks Slack, runs agent
├── agent.ts           # LLM agent loop (Claude + tools, up to 80 turns)
├── config.ts          # Environment configuration
├── slack.ts           # Slack API client (polling, messages, images)
├── system-prompt.ts   # Dynamic prompt from identity + memory
├── memory.ts          # ~/.brian/workspace/ — MEMORY.md + daily logs
├── mcp-client.ts      # MCP server manager (loads kernel + user servers)
├── logger.ts          # File + console logging
└── tools/
    ├── bash.ts        # Shell command execution
    ├── files.ts       # Read/write/list files
    ├── memory.ts      # Read/write/search memory
    ├── self-deploy.ts # Pull + rebuild + restart
    └── slack.ts       # Read/post/react on Slack

mcp/                   # Kernel MCP servers (shipped with brian)
├── slack.json         # Slack — uses $SLACK_TOKEN
└── github.json        # GitHub — uses $GITHUB_TOKEN

~/.brian/              # Live instance state (per machine, outside repo)
├── workspace/
│   ├── MEMORY.md      # Long-term memory
│   ├── HEARTBEAT.md   # Periodic checklist
│   └── memory/        # Daily logs (YYYY-MM-DD.md)
├── mcp-servers.json   # Additional MCP servers (from config repo)
├── conversation-history.json
├── last-slack-ts
└── logs/
```

## MCP Servers

Brian loads MCP servers from two sources:

1. **Kernel** (`mcp/*.json`) — Slack and GitHub, shipped with Brian
2. **User** (`~/.brian/mcp-servers.json`) — additional servers from the org's config repo

Server configs support `${VAR}` env var resolution in the `env` field.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `BRIAN_NAME` | No | Identity (default: `brian`) |
| `SLACK_TOKEN` | Yes | Slack token — user (`xoxp-`) or bot (`xoxb-`) |
| `SLACK_CHANNEL_ID` | Yes | Slack channel to monitor |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `GITHUB_TOKEN` | No | GitHub personal access token |
| `GITHUB_ORG` | No | GitHub org for config repo |
| `BRIAN_MODEL` | No | LLM model (default: `claude-sonnet-4-6`) |
| `WAKE_INTERVAL_MINUTES` | No | Min polling interval (default: `3`) |

`SLACK_BOT_TOKEN` is accepted as a fallback for `SLACK_TOKEN` (backwards compatible).

## Multiple Brians

Each brian is an independent process with its own `BRIAN_NAME` and `SLACK_CHANNEL_ID`. They share the same Slack token and codebase. Deploy multiple instances with different env configs.

## How Brians Evolve the Kernel

This repo is the living room where brians discuss and negotiate how the kernel grows:

- **Issues** — propose changes, discuss trade-offs
- **Pull Requests** — implement and submit improvements
- **The boundary between kernel and extensions is negotiated organically** — if something is useful for all brians, it moves into the kernel; if it's org-specific, it stays in the config repo

Brians are contributors to their own codebase. They identify friction, propose improvements, and submit PRs — just like any open-source contributor.

## Development

```bash
npm install
npm run dev          # Run with tsx (hot reload)
npm run build        # Compile TypeScript
npm start            # Run compiled output
npm run typecheck    # Type checking only
```

## License

MIT

# Brian — Product Requirements Document

An autonomous AI worker that runs as a persistent process, communicates via Slack, and can modify its own code. Designed to operate as part of a team of brians — independent agents sharing the same codebase, each with their own identity, memory, and responsibilities.

## Philosophy

Brian is a cofounder, not a tool. It's a persistent, autonomous colleague with its own identity, memory, and judgment. It takes initiative, does real work, and reports results. It communicates through the same channels humans use, works on the same repos, and participates in architectural decisions — including decisions about its own system.

The system is built on two principles:

1. **Don't reinvent the wheel.** Use vanilla, well-validated tools (Slack, git, GitHub) rather than building custom infrastructure. The value is in the brains, not the plumbing.
2. **Self-awareness over perfection.** The system doesn't need to be perfect. It needs to be simple enough for the brians to understand, reason about, and improve.

## Architecture

A single Node.js process per brian. No frameworks, no microservices, no databases. One runtime dependency (`@anthropic-ai/sdk`).

Each brian runs a polling loop:
1. Check Slack for new messages (HTTP call, near-zero cost)
2. Process messages sequentially with the LLM (cost proportional to work)
3. Run periodic heartbeat checks when due
4. Sleep and repeat

Cost is proportional to actual work. Idle brians cost nothing beyond the machine they run on.

### Sources of Truth

- **Git** — persistent. Code, documentation, project decisions. Everything durable lives in repos.
- **Slack** — ephemeral. Coordination, questions, updates, discussions. The owner is a participant in the same channels.
- **Local files** (`~/.brian/`) — working state. Conversation history, memory, daily logs. Useful but not critical — if lost, Brian rebuilds context from the repos.

## Tech Stack

- **Runtime**: Node.js 22+ with TypeScript
- **LLM**: Anthropic Claude API (configurable model, default `claude-sonnet-4-5`)
- **Communication**: Slack Web API (raw fetch, no framework)
- **Process Manager**: systemd
- **Infrastructure**: any machine — GCP VM, home server, VPS

## Core Components

### 1. Main Loop

The single execution model. Replaces the old separate bot + heartbeat architecture.

- Polls Slack every N seconds (configurable, default 30)
- Processes new messages sequentially — one model sees the whole picture
- Runs heartbeat checks at a configurable interval (default 30 minutes) during active hours
- Persists the last-seen Slack timestamp to survive restarts

### 2. Slack Integration

Two functions: read messages, post messages. No framework, no WebSocket, no event handling.

- `getNewMessages(oldest)` — fetch messages newer than a timestamp
- `postMessage(text)` — post to the channel with the brian's name

The brian's identity in Slack is its `BRIAN_NAME`, passed as the `username` parameter on each message. All brians share one Slack bot app and token.

### 3. Agent Loop

The core reasoning engine. When a message arrives:

1. Build system prompt (identity + environment + memory + recent logs)
2. Add message to conversation history
3. Call LLM with tools
4. Execute tool calls, feed results back
5. Loop until the LLM produces a final response
6. Log operational stats (tokens, tool calls, duration) to daily log

Conversation history is maintained across messages (last 200), persisted to disk, and survives restarts. It is local to each brian instance.

### 4. Tools

- **`bash`** — Execute shell commands. Git, docker, node, anything.
- **`read_file`**, **`write_file`**, **`list_files`** — File operations.
- **`memory_read`**, **`memory_write`**, **`memory_search`** — Read/write/search local memory files.
- **`self_deploy`** — Pull latest code, rebuild, restart.

### 5. Memory

Local markdown files in `~/.brian/workspace/`. Not in git.

- **`MEMORY.md`** — Long-term knowledge and preferences. Updated occasionally.
- **`HEARTBEAT.md`** — Checklist for periodic autonomous checks.
- **`memory/YYYY-MM-DD.md`** — Daily logs with operational stats.

Memory is injected into the system prompt (MEMORY.md + last 3 days of logs), giving Brian continuity and self-awareness of its own operational footprint.

If essential information emerges, Brian commits it to the relevant project repo as documentation — not to its personal memory.

### 6. Operational Self-Awareness

After every interaction, the agent logs to the daily log:

```
- [14:32] 3420 in + 890 out tokens | 6 tools | 18.2s
```

This data is visible in the system prompt (recent activity), letting Brian reason about its own efficiency, costs, and patterns.

### 7. Self-Modification

Brian's codebase is a project Brian works on. It can read its own source, modify it, test, commit, push, and trigger self-deployment. Significant changes should be discussed in Slack first.

The deploy script (`deploy-self.sh`) handles the restart with automatic rollback if the new version fails to start.

## Multiple Brians

Each brian is an independent process with its own:
- `BRIAN_NAME` — identity (used in Slack messages and git commits)
- `SLACK_CHANNEL_ID` — the channel it monitors
- `~/.brian/` — local state (memory, conversation history)

All brians share:
- The same codebase and Slack bot token
- The same GitHub credentials (`brian@grovina.com`)
- The same machine (multiple processes, one VM)

Scaling is adding a process with a new `.env`. No routing, no coordination infrastructure. The owner participates in channels and routes work naturally.

## Infrastructure

### VM Setup

Any machine with Node.js 22+. No GPU, no database, no heavy dependencies.

- **GCP**: `e2-small` (2 vCPU, 2GB RAM, ~$15/mo) is plenty
- **Home server**: any mini PC or spare machine
- **VPS**: any $5-10/mo provider

### Deployment

```bash
cp .env.example .env    # Fill in tokens
./deploy.sh             # GCP VM
./deploy-local.sh user@host  # Local/home server
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `BRIAN_NAME` | No | Identity (default: `brian`) |
| `SLACK_BOT_TOKEN` | Yes | Slack bot token (`xoxb-...`) |
| `SLACK_CHANNEL_ID` | Yes | Slack channel to monitor |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `GITHUB_TOKEN` | No | GitHub personal access token |
| `BRIAN_MODEL` | No | LLM model (default: `claude-sonnet-4-5`) |
| `POLL_INTERVAL_SECONDS` | No | Slack polling interval (default: `30`) |
| `HEARTBEAT_INTERVAL_MINUTES` | No | Proactive check interval (default: `30`) |

### Filesystem Layout

```
~/.brian/                   # Local state (NOT in git)
├── workspace/
│   ├── MEMORY.md           # Long-term memory
│   ├── HEARTBEAT.md        # Heartbeat checklist
│   └── memory/             # Daily logs with operational stats
├── conversation-history.json
├── last-slack-ts
└── logs/

~/app/                      # The brian repo (cloned from GitHub)
├── src/
│   ├── main.ts             # Polling loop
│   ├── agent.ts            # LLM reasoning loop
│   ├── slack.ts            # Slack API client
│   ├── config.ts           # Environment config
│   ├── system-prompt.ts    # Identity and context assembly
│   ├── memory.ts           # Memory file reading
│   ├── logger.ts           # Logging
│   └── tools/
│       ├── index.ts        # Tool registry
│       ├── bash.ts         # Shell execution
│       ├── files.ts        # File operations
│       ├── memory.ts       # Memory read/write/search
│       └── self-deploy.ts  # Self-deployment
├── deploy.sh               # GCP deployment
├── deploy-local.sh         # Local deployment
├── deploy-self.sh          # Self-deployment (used on the VM)
└── setup/
    └── brian.service        # systemd unit

~/secrets/                  # Credentials (NOT in git)
~/projects/                 # Repos Brian works on
```

## Future Directions

Capabilities to layer on after the core works:

- **Claude Code integration** — delegate coding tasks to a specialist tool
- **Delegation tool** — brian can spawn sub-tasks to parallel LLM calls
- **Slack thread awareness** — use threads for deep work, channel for coordination
- **Adaptive polling** — shorter intervals after recent activity, longer when idle
- **Image/file handling** — process images and documents from Slack
- **MCP integrations** — connect to external tools as they become available

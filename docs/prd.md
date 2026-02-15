# Brian — Product Requirements Document

A self-hosted AI agent that acts as a personal developer, assistant, and manager. It runs as a persistent process on a VM, communicates via Telegram, executes tasks using shell tools, and can modify its own code.

## Philosophy

Brain is a process that controls a computer on your behalf. It's not an IDE, not a chatbot, not an orchestrator. It's a developer with shell access, git credentials, Docker, and an LLM for reasoning. It receives instructions via Telegram, works on projects by running real commands, and reports back.

It should feel like messaging a competent colleague who has access to your servers and repos. Not a UI you operate — a person you talk to.

## Architecture

One Node.js process running on a GCE VM. No microservices, no container orchestration, no serverless. The process has:

- A Telegram bot connection (receives messages, sends replies)
- An LLM-powered agent loop (thinks, calls tools, iterates)
- Shell access to the VM (bash, git, docker, node, etc.)
- A filesystem workspace for projects, memory, and secrets
- A heartbeat timer for periodic autonomous behavior

The VM has Docker installed. The agent can run `docker compose`, build images, start databases — everything a developer does. This isn't for sandboxing the agent; it's because real development requires Docker.

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **LLM**: Anthropic Claude API (claude-sonnet-4-20250514 as default, configurable)
- **Telegram**: grammy (lightweight, well-maintained Telegram bot framework)
- **Process Manager**: systemd on the VM
- **Infrastructure**: Google Cloud Compute Engine
- **No framework needed** — this is a single-purpose daemon, not a web app. No Express, no NestJS. Just a TypeScript process with a few modules.

## Core Components

### 1. Telegram Interface

The sole user interface. All interaction happens through a Telegram bot.

**Capabilities:**

- Receive text messages as task instructions
- Receive files (`.env` files, keys, config) and store them appropriately
- Send text replies (task progress, results, questions)
- Send files back (diffs, logs, generated assets)
- Long messages should be split or sent as files

**Security:**

- Only respond to messages from a configured Telegram user ID (the owner)
- Ignore all other messages silently

**Implementation notes:**

- Use grammy's bot framework with long polling (simpler than webhooks for a VM setup)
- Support markdown formatting in replies
- Handle file uploads: when the user sends a document, save it to `~/secrets/` (or a path the user specifies in the caption)

### 2. Agent Loop

The core reasoning engine. When a message arrives, the agent loop:

1. Assembles context: the user's message, relevant memory, current state
2. Sends it to the LLM with available tools
3. The LLM decides what to do: call tools, ask questions, or respond
4. Tool results feed back into the LLM
5. The loop continues until the LLM produces a final response
6. The response is sent back via Telegram

**LLM integration:**

- Use the Anthropic SDK directly (`@anthropic-ai/sdk`)
- Support tool use (function calling) natively
- System prompt defines the agent's identity, capabilities, and behavioral guidelines
- Conversation history is maintained per-session with the user
- The model should have extended thinking enabled for complex tasks

**Context management:**

- Keep a rolling conversation window (last N messages or token-limited)
- Inject relevant memory at the start of each conversation
- When context gets too long, summarize older messages and compact

**Error handling:**

- If a tool call fails, the error is fed back to the LLM so it can adapt
- If the LLM API fails, retry with exponential backoff
- If a task is taking too long, send a progress update via Telegram

### 3. Tools

The agent has access to tools that the LLM can call. These are the agent's hands.

**Shell (`bash`)**

- Execute arbitrary shell commands on the VM
- Stream long-running output and provide updates
- Support working directory context
- Timeout after a configurable duration (default: 5 minutes per command)

**File operations (`read_file`, `write_file`, `list_files`)**

- Read file contents
- Write/overwrite files
- List directory contents
- All paths relative to a working directory (the current project or workspace)

**Git operations**

- These are just shell commands (`git clone`, `git checkout`, `git push`, etc.)
- No special git tool needed — bash is sufficient
- The agent has a GitHub token available as an environment variable

**Docker operations**

- Also just shell commands (`docker compose up`, `docker build`, etc.)
- Docker is installed on the VM and available to the agent

**Memory tools (`memory_read`, `memory_write`, `memory_search`)**

- Read from memory files
- Append to or update memory files
- Search memory by keyword or semantic similarity (start with keyword search; vector search can be added later)

**Self-management (`self_deploy`)**

- Trigger a self-deployment: pull latest code, install deps, restart
- This calls the `deploy-self.sh` script, which is external to the process
- The tool should confirm with the user before executing

### 4. Memory System

Memory is plain Markdown files stored in the brain's own git repo. The files are the source of truth.

**File structure:**

```
workspace/
├── MEMORY.md              # Durable knowledge: preferences, decisions, project notes
├── HEARTBEAT.md           # Checklist for periodic heartbeat runs
├── memory/
│   └── YYYY-MM-DD.md      # Daily log entries
└── secrets/
    └── MANIFEST.md        # Inventory of available credentials
```

**MEMORY.md** — Long-term facts and preferences. Things like "the platform monorepo uses pnpm", "deploy payper with ./scripts/deploy.sh payper-backend", "the owner prefers concise updates". The agent writes here when it learns something durable.

**memory/YYYY-MM-DD.md** — Daily log. What happened today: tasks completed, errors encountered, things learned. Append-only during the day.

**HEARTBEAT.md** — A checklist the agent reads during each heartbeat cycle. Defines what periodic checks to perform.

**secrets/MANIFEST.md** — An inventory of what credentials the agent has (not the credentials themselves). Records what was received, when, and whether it's still valid. The actual secret files live in `~/secrets/` on the VM filesystem (not committed to git).

**Persistence:** Memory files are committed to the brain's git repo. Secrets are not (they're in `.gitignore`). This means memory survives VM destruction; secrets need to be re-provided (the manifest tells the agent what to ask for).

### 5. Heartbeat

A periodic timer that triggers an autonomous agent turn. The agent wakes up, reads `HEARTBEAT.md`, checks on things, and either takes action or goes back to sleep.

**Configuration:**

- Interval: configurable, default 30 minutes
- Active hours: configurable window (e.g., 08:00–22:00) to avoid overnight activity
- The heartbeat is just a self-sent message that enters the normal agent loop

**Behavior:**

- Read `HEARTBEAT.md` for the current checklist
- Check each item (e.g., "any failed CI runs?", "any open PRs needing attention?")
- If nothing needs attention, do nothing (don't message the user)
- If something needs attention, message the user via Telegram
- The agent can update `HEARTBEAT.md` itself over time

**Examples of heartbeat checks:**

- Check GitHub notifications
- Monitor CI status on open PRs
- Remind about stale branches
- Follow up on tasks from earlier conversations

### 6. Self-Modification

The brain's code lives in its own GitHub repo (`grovina/brain`). The agent can work on this repo like any other project. This is what allows it to improve itself.

**The flow:**

1. The agent (or user) identifies something to improve
2. The agent creates a branch in its own repo
3. It makes code changes (new tools, better prompts, bug fixes, refactors)
4. It runs tests (`npm test`)
5. It pushes the branch and creates a PR
6. After merge (manual approval or auto-merge), it triggers self-deploy

**Self-deploy mechanism:**
A shell script (`deploy-self.sh`) on the VM handles the deploy:

- Records the current git commit (for rollback)
- Pulls latest from main
- Installs dependencies
- Restarts the brain process via systemd
- Waits for the new process to come alive (health check)
- If the process fails to start within 30 seconds, rolls back to the previous commit and restarts

The brain triggers this script via `nohup ./deploy-self.sh &` — the script outlives the brain process because it's detached.

**Safety:**

- The brain works on branches, not directly on main
- Tests must pass before pushing
- The deploy script auto-rolls back on crash
- systemd restarts the process on unexpected crashes (`Restart=on-failure`)
- If everything fails, `./deploy.sh` from a laptop rebuilds from scratch

## Infrastructure

### VM Setup

**Machine type:** `e2-small` (2 vCPU, 2GB RAM) — sufficient for the brain daemon plus light Docker workloads. Can be upgraded if needed.

**OS:** Debian 12 (bookworm) or Ubuntu 24.04

**Installed software:**

- Node.js 22+ (via nodesource or nvm)
- Docker + Docker Compose
- Git
- Standard build tools (gcc, make, etc. for native npm modules)

**Region:** `europe-west1` (or configurable)

### Bootstrap Script (`deploy.sh`)

A single script run from a developer laptop that creates or updates the entire setup.

**Usage:**

```bash
./deploy.sh \
  --telegram-token "BOT_TOKEN" \
  --anthropic-key "sk-ant-..." \
  --github-token "ghp_..." \
  --owner-telegram-id "123456789"
```

**What it does (first run):**

1. Creates a GCE VM with the configured machine type
2. Waits for the VM to be ready
3. SSHs into the VM and runs setup:
   - Installs Node.js, Docker, git
   - Clones the brain repo from GitHub
   - Runs `npm install`
   - Writes environment variables to `/etc/brain/env`
   - Installs and starts the systemd service
4. Confirms the brain is running (health check)
5. Prints the Telegram bot name

**What it does (subsequent runs):**

1. SSHs into the existing VM
2. Pulls latest code
3. Reinstalls dependencies
4. Restarts the service

**Destroy script (`destroy.sh`):**

- Deletes the GCE VM
- Optionally cleans up associated resources (firewall rules, etc.)

### Systemd Service

```ini
[Unit]
Description=Brain AI Agent
After=network.target docker.service

[Service]
Type=simple
User=brain
WorkingDirectory=/home/brain/app
EnvironmentFile=/etc/brain/env
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=5
StartLimitBurst=5
StartLimitIntervalSec=60

[Install]
WantedBy=multi-user.target
```

### Self-Deploy Script (`deploy-self.sh`)

Lives on the VM at `/home/brain/deploy-self.sh`. The brain triggers it to deploy changes to itself.

```bash
#!/bin/bash
set -e

cd /home/brain/app
PREVIOUS=$(git rev-parse HEAD)

git pull origin main
npm ci
npm run build

sudo systemctl restart brain

sleep 20

if ! systemctl is-active --quiet brain; then
  git checkout "$PREVIOUS"
  npm ci
  npm run build
  sudo systemctl restart brain
fi
```

## Filesystem Layout on the VM

```
/home/brain/
├── app/                    # The brain repo (cloned from GitHub)
│   ├── src/                # Source code
│   ├── workspace/          # Memory files (committed to git)
│   │   ├── MEMORY.md
│   │   ├── HEARTBEAT.md
│   │   └── memory/
│   ├── deploy-self.sh
│   ├── package.json
│   └── tsconfig.json
├── secrets/                # Credentials (NOT in git)
│   ├── MANIFEST.md         # Inventory (this one IS committed via workspace)
│   └── ... (.env files, tokens, keys)
├── projects/               # Cloned repos the agent works on
│   └── platform/           # e.g., the grovina/platform monorepo
└── deploy-self.sh          # Self-deploy script (copied from app/)

/etc/brain/
└── env                     # Environment variables (Telegram token, API keys)
```

## Configuration

Stored as environment variables in `/etc/brain/env`:

```bash
TELEGRAM_BOT_TOKEN=...
TELEGRAM_OWNER_ID=...          # Only respond to this user
ANTHROPIC_API_KEY=...
GITHUB_TOKEN=...
BRAIN_MODEL=claude-sonnet-4-20250514  # Default LLM model
HEARTBEAT_INTERVAL_MINUTES=30
HEARTBEAT_ACTIVE_HOURS_START=08:00
HEARTBEAT_ACTIVE_HOURS_END=22:00
```

Additional configuration can be added as needed. No config file format — just env vars.

## First Boot Experience

1. Developer runs `./deploy.sh` with the three required tokens + owner Telegram ID
2. VM is created, software installed, brain deployed
3. The brain connects to Telegram and sends a message to the owner:

   > "Hello! I'm online. I have shell access, Docker, and git on this machine. I don't know anything about your projects yet — tell me what to work on or send me files I'll need."

4. The owner can now:
   - Send tasks: "Clone grovina/platform and explore the structure"
   - Send files: attach a `.env` file with a caption like "this is for the payper app"
   - Ask questions: "What do you know so far?"

5. Over time, the brain accumulates context, credentials, and project knowledge through natural conversation.

## Project Structure

```
brain/
├── deploy.sh               # Create/update VM from laptop
├── destroy.sh              # Tear down VM
├── deploy-self.sh          # Self-deploy script (used on the VM)
├── setup/
│   └── cloud-init.yaml     # VM initialization (packages, users, etc.)
├── src/
│   ├── main.ts             # Entry point: starts Telegram bot + heartbeat
│   ├── config.ts           # Environment variable loading
│   ├── telegram.ts         # Telegram bot setup, message routing, file handling
│   ├── agent.ts            # Agent loop: LLM conversation with tool calling
│   ├── system-prompt.ts    # System prompt assembly (identity + context + memory)
│   ├── tools/
│   │   ├── index.ts        # Tool registry
│   │   ├── bash.ts         # Shell command execution
│   │   ├── files.ts        # File read/write/list
│   │   ├── memory.ts       # Memory read/write/search
│   │   └── self-deploy.ts  # Trigger self-deployment
│   ├── memory.ts           # Memory file management
│   └── heartbeat.ts        # Periodic heartbeat scheduler
├── workspace/
│   ├── MEMORY.md           # Long-term memory (committed to git)
│   ├── HEARTBEAT.md        # Heartbeat checklist (committed to git)
│   └── memory/             # Daily logs (committed to git)
├── package.json
├── tsconfig.json
├── .gitignore              # Excludes secrets/, node_modules/, dist/
└── README.md
```

## System Prompt

The system prompt defines who the brain is. It should be stored in `src/system-prompt.ts` and assembled at runtime. It includes:

1. **Identity**: Who the agent is, who the owner is, what its purpose is
2. **Capabilities**: What tools it has, what it can do
3. **Workspace context**: Current working state, available projects and credentials
4. **Memory**: Relevant entries from `MEMORY.md` and recent daily logs
5. **Guidelines**: How to communicate (concise Telegram messages), when to ask vs. act, how to handle secrets

The system prompt should be clear and purposeful, not prescriptive. Trust the model's judgment.

## Future Directions (Not in Scope for V1)

These are capabilities that could be layered on after the core works:

- **Voice messages**: Transcribe Telegram voice messages using Whisper/Gemini, respond with TTS
- **Voice calls**: Real-time audio conversation via Telegram calls or WebRTC
- **Webhook reactions**: GitHub webhooks that trigger agent responses (PR reviews, CI failures)
- **Vector memory search**: Embed memory chunks for semantic retrieval
- **Multiple projects simultaneously**: Working on several repos with context switching
- **Proactive behavior**: The agent notices things and acts without being asked
- **Web browsing**: Playwright/Puppeteer for web research or testing
- **Stronger scaling**: Spin up a bigger VM on demand for heavy Docker workloads, then stop it

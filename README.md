# Brian

Brian is a framework for autonomous AI coworkers. Not a chatbot — a persistent colleague that runs continuously, decides what to do, and acts.

## Philosophy

Brian operates as a **single eternal turn**. There are no wake/sleep cycles, no scheduled jobs, no event-driven triggers. The agent runs one continuous loop: think, act, repeat. When there's nothing to do, it calls `wait` — a tool like any other — and resumes when the wait is over. Process restarts are just blips; the conversation picks up where it left off.

Each brian runs from **its own fork** of this repo on its own VM. It can read and modify its own code, open PRs, and redeploy itself. The fork is the deployment unit — not a read-only dependency.

Instance-specific state (memory, conversation history, credentials) lives in `~/.brian/` on the VM, outside the repo. The repo stays org-agnostic; no merge conflicts when syncing upstream.

Brian communicates with humans and other brians via **Slack**, and works with code via **GitHub** (through `gh`). It has full shell access and can install and use any headless CLI tool on its VM.

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/grovina/brian/main/bootstrap.sh | bash
```

The bootstrap script forks this repo to your org, deploys the fork to a GCP VM, and runs `brian setup` to initialize everything.

## Architecture

```text
src/
├── start.ts              # Entry point (reads env vars, wires everything)
├── brian.ts              # Brian class — orchestrates agent + integrations
├── agent.ts              # The loop: think → act → observe → repeat
├── types.ts              # Core interfaces (Message, Tool, ModelProvider)
├── prompt.ts             # System prompt builder
├── memory.ts             # memory.md access
├── turns.ts              # Turn snapshots (one file per model call)
├── updates.ts            # External event queue (drained at control points)
├── slack.ts              # Slack polling and message routing
├── model.ts              # Model provider factory
├── models/
│   ├── vertex-ai.ts      # Google Vertex AI (Gemini)
│   └── anthropic.ts      # Anthropic (Claude)
├── tools/
│   ├── bash.ts           # Shell execution
│   ├── wait.ts           # Pause execution (agent-controlled pacing)
│   └── slack.ts          # Send messages and reactions
└── cli/
    └── brian.ts           # brian CLI (setup, redeploy, sync, doctor)
```

### The Loop

`Agent.loop()` is `Promise<never>` — it literally never returns. Each iteration:

1. Build the turn input (system prompt + conversation history + tools)
2. Call the model
3. If tool calls: execute them, drain any queued external updates, push results back
4. If no tool calls: inject a time marker or pending updates
5. Trim history (with honest compaction marker when messages are dropped)
6. Checkpoint conversation to `history.json`
7. Repeat

The model always has something to respond to. External events (Slack messages) queue up and get injected at natural control points — after tool execution. The agent never misses anything; it just processes updates when it's ready.

When the conversation window exceeds its limit, older messages are dropped and a compaction marker is injected so the model knows context was lost. Long-term knowledge persists in `memory.md` — the model is responsible for keeping it current.

### State

```text
~/.brian/
├── memory.md              # Long-term knowledge (agent-managed via bash)
├── history.json           # Current conversation window (checkpoint for restarts)
├── slack.json             # Slack polling state
└── turns/                 # One JSON file per model call (observability/debugging)
    └── {datetime}.json
```

### Tools

Brian's tool system is minimal:

- **`bash`** — Shell execution. This is the primary way brian interacts with the world: git, gh, docker, node, file manipulation, CLI tools.
- **`wait`** — Pause for N minutes. The agent decides when and how long to wait based on context. No scheduler, no cron — just a tool call.
- **`slack_send` / `slack_react`** — Send messages and reactions. Routing metadata from incoming events enables threaded replies.

### Model Providers

Implements `ModelProvider` to abstract LLM backends:

- **Vertex AI** — Gemini via Google Cloud (default)
- **Anthropic** — Claude via Anthropic API

Selected at runtime via `MODEL_PROVIDER` env var.

### CLI

```bash
brian setup                 # Initialize state and install systemd service
brian redeploy              # Pull, build, restart (with rollback on failure)
brian config check          # Validate config and model connectivity
brian doctor                # Full health check
brian sync                  # Sync fork with upstream (fast-forward)
brian sync --force          # Force-align fork to upstream
brian sync --check          # Check fork status only
```

## How Contributions Flow

When a brian identifies a generic improvement:

1. It makes the change in the org's fork
2. The improvement is live immediately for that org
3. It opens a PR from the fork to this upstream repo
4. Once merged, all forks benefit

The framework stays org-agnostic. Instance-specific configuration belongs in `~/.brian/`, not in the repo.

## Configuration

Environment variables (typically in `/etc/brian/env`):

| Variable | Required | Description |
|---|---|---|
| `BRIAN_NAME` | Yes | Agent name (also used as git author) |
| `MODEL_PROVIDER` | No | `vertex-ai` (default) or `anthropic` |
| `MODEL_ID` | No | Override default model |
| `GCP_PROJECT` | For Vertex AI | Google Cloud project |
| `VERTEX_AI_LOCATION` | No | Region (default: `global`) |
| `ANTHROPIC_API_KEY` | For Anthropic | API key |
| `SLACK_TOKEN` | No | Slack user token (`xoxp-...`) |
| `BRIAN_STATE_DIR` | No | State directory (default: `~/.brian`) |
| `BRIAN_REPO_DIR` | No | Repo directory (default: auto-detected) |

Setup guides: [Vertex AI](docs/vertex-ai-setup.md) · [Anthropic](docs/anthropic-setup.md) · [Slack](docs/slack-setup.md) · [GitHub](docs/github-setup.md)

## License

MIT

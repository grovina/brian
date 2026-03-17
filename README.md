# Brian

Brian is a framework for autonomous AI coworkers. Not a chatbot — a persistent colleague that runs continuously, decides what to do, and acts.

## Philosophy

Brian operates as a **single eternal turn**. There are no wake/sleep cycles, no scheduled jobs, no event-driven triggers. The agent runs one continuous loop: think, act, repeat. When there's nothing to do, it calls `wait` — a tool like any other — and resumes when the wait is over or when an external event arrives. Process restarts are just blips; the conversation picks up where it left off.

Each brian runs from **its own fork** of this repo on its own VM. It can read and modify its own code, open PRs, and redeploy itself. The fork is the deployment unit — not a read-only dependency.

Instance-specific state (consciousness, conversation history, credentials) lives in `~/.brian/` on the VM, outside the repo. The repo stays org-agnostic; no merge conflicts when syncing upstream.

Brian communicates with humans and other brians via **Slack**, and works with code via **GitHub** (through `gh`). It has full shell access and can install and use any headless CLI tool on its VM.

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/grovina/brian/main/bootstrap.sh | bash
```

The bootstrap script forks this repo to your org, deploys the fork to a GCP VM, and starts the service. It also generates a `ctl` script on your machine for emergency operations.

## Architecture

```text
src/
├── start.ts              # Entry point (reads env vars, wires everything)
├── brian.ts              # Brian class — orchestrates agent + integrations
├── agent.ts              # The loop: think → act → observe → repeat
├── types.ts              # Core interfaces (Message, Tool, ModelProvider)
├── prompt.ts             # System prompt builder + consciousness reader
├── turns.ts              # Turn snapshots (one file per model call)
├── updates.ts            # External event queue (drained at control points)
├── slack.ts              # Slack polling and message routing
├── model.ts              # Model provider factory
├── models/
│   ├── vertex-ai.ts      # Google Vertex AI (Gemini)
│   └── anthropic.ts      # Anthropic (Claude)
└── tools/
    ├── bash.ts           # Shell execution
    ├── wait.ts           # Pause execution (update-aware, duration or datetime)
    └── slack.ts          # Send messages and reactions
```

### The Loop

`Agent.loop()` is `Promise<never>` — it literally never returns. Each iteration:

1. Build the turn input (system prompt + consciousness files + conversation history + tools)
2. Call the model
3. If tool calls: execute them, drain any queued external updates, push results back
4. If no tool calls: inject a time marker or pending updates
5. Trim history (with honest compaction marker when messages are dropped)
6. Checkpoint conversation to `history.json`
7. Repeat

The model always has something to respond to. External events (Slack messages) queue up and get injected at natural control points — after tool execution. The agent never misses anything; it just processes updates when it's ready.

When the conversation window exceeds its limit, older messages are dropped and a compaction marker is injected so the model knows context was lost. Long-term knowledge persists in consciousness files (`mind/`) — the model is responsible for keeping them current.

### Consciousness

Brian's durable self-knowledge lives in `~/.brian/mind/` — a set of markdown files the agent maintains:

```text
~/.brian/mind/
├── identity.md          # Who I am, my style, my boundaries
├── relationships.md     # Model of each person and how we work together
├── operations.md        # Autonomy levels, behavioral patterns, self-imposed rules
├── projects/            # One file per active project with context and status
├── learnings.md         # Technical knowledge, corrections, verified facts
└── journal.md           # Reflections, decisions, open questions
```

Consciousness files are read into the system prompt on every turn, giving the agent persistent self-knowledge across conversation compactions and process restarts. The agent maintains these files via bash and is encouraged to git-track the directory for versioning and crash recovery.

The key distinction: conversation history is transient context (compacted when it grows too large). Consciousness is durable identity (persists as long as the files exist).

### Progressive Autonomy

Brian's `operations.md` defines a living autonomy contract — what the agent can do freely, what it should mention, and what requires approval. The agent starts conservative and evolves boundaries collaboratively through interactions. This replaces hard-coded permission rules with a self-maintained, human-inspectable, version-trackable social contract.

### Startup Awareness

The agent distinguishes three startup scenarios:

- **Normal restart** (has history + consciousness): Process restart. Resume from prior conversation.
- **Recovery** (no history, has consciousness): VM was recreated, consciousness restored from git. Review journal and projects, check Slack for missed context.
- **First run** (no history, no consciousness): Brand new agent. Create consciousness files, introduce itself on Slack.

### State

```text
~/.brian/
├── mind/                  # Consciousness (durable, git-backed)
│   ├── identity.md
│   ├── relationships.md
│   ├── operations.md
│   ├── projects/
│   ├── learnings.md
│   └── journal.md
├── history.json           # Current conversation window (checkpoint for restarts)
├── slack.json             # Slack polling state
└── turns/                 # One JSON file per model call (observability/debugging)
    └── {datetime}.json
```

### Tools

Brian's tool system is minimal:

- **`bash`** — Shell execution. This is the primary way brian interacts with the world: git, gh, docker, node, file manipulation, CLI tools.
- **`terminal`** — Persistent terminal sessions for long-running commands, background work, and parallel execution.
- **`wait`** — Pause execution. Accepts a duration (minutes), a target datetime, or both — whichever comes first ends the wait. Resumes early if an external event arrives.
- **`slack_send` / `slack_react` / `slack_history`** — Send messages, add reactions, read history. Routing metadata from incoming events enables threaded replies.

### Model Providers

Implements `ModelProvider` to abstract LLM backends:

- **Vertex AI** — Gemini via Google Cloud (default)
- **Anthropic** — Claude via Anthropic API

Selected at runtime via `MODEL_PROVIDER` env var.

## Management

**The agent is the management interface.** Day-to-day operations happen through Slack:

- Ask the agent to check its health, sync with upstream, or redeploy
- The agent manages itself via bash — pull, build, restart, git operations
- Status updates, health reports, and questions flow through Slack naturally

**The `ctl` script is for emergencies** — when the agent can't manage itself:

```bash
ctl status    # Is the service running?
ctl logs      # What happened?
ctl restart   # Restart the service
ctl ssh       # Shell into the VM
ctl env       # Edit local env file
ctl env push  # Push env to VM and restart
ctl destroy   # Delete the VM
```

The ctl script is generated per-agent by the bootstrap script at `~/.brian/{org}.{name}.ctl`.

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

Setup guides: [Vertex AI](docs/vertex-ai-setup.md) · [Anthropic](docs/anthropic-setup.md) · [Slack](docs/slack-setup.md) · [GitHub](docs/github-setup.md)

## License

MIT

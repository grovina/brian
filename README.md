# Brian

Framework for autonomous AI coworkers. Brian is not a chatbot — it's the foundation for building persistent, autonomous agents that wake up, look around, decide what to do, and act.

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/grovina/brian/main/bootstrap.sh | bash
```

The bootstrap script forks this repo to your org, scaffolds your brian's project, and installs everything. You end up with two repos:

- **`your-org/brian`** — your fork of the framework (editable, stays in sync with upstream)
- **`your-org/pickle`** — your brian's implementation (name, instructions, MCP configs, deploy scripts)

## What You Get

A brian built on this framework is a long-running process that:

- **Wakes up on a schedule** — checks communication channels, ongoing tasks, notifications
- **Acts autonomously** — uses tools (bash, MCP servers, memory) to get work done
- **Controls its own schedule** — sleeps longer when idle, checks back quickly when busy
- **Remembers across restarts** — persistent memory, conversation history, daily logs
- **Improves itself** — can modify its own code, open PRs, and self-deploy

## Usage

```typescript
import { Brian, VertexAI, PeriodicWake, bash, selfDeploy } from 'brian';

const brian = new Brian({
  name: process.env.BRIAN_NAME || 'brian',

  model: new VertexAI({
    project: process.env.GCP_PROJECT!,
    region: process.env.GCP_REGION || 'europe-west1',
  }),

  wake: new PeriodicWake({
    intervalMinutes: 3,
    maxIntervalMinutes: 60,
  }),

  tools: [bash, selfDeploy()],

  mcp: './mcp/',
  instructions: './instructions.md',
});

await brian.start();
```

## Architecture

```
src/
├── index.ts              # Public API
├── brian.ts              # Brian class — orchestrates everything
├── types.ts              # Core interfaces
├── agent.ts              # Model-agnostic agent loop
├── prompt.ts             # System prompt builder
├── memory.ts             # Workspace: MEMORY.md, HEARTBEAT.md, daily logs
├── mcp.ts                # MCP server manager
├── logger.ts             # File + console logging
├── models/
│   └── vertex-ai.ts      # VertexAI (Gemini) provider
├── wake/
│   └── periodic.ts       # Periodic wake with backoff
└── tools/
    ├── bash.ts           # Shell execution
    ├── memory.ts         # Memory read/write/search (built-in)
    └── self-deploy.ts    # Self-deployment trigger
```

## Core Concepts

### Model Providers

Implement `ModelProvider` to add LLM backends. The framework ships with `VertexAI` (Gemini via Google Cloud).

### Wake Strategies

Implement `WakeStrategy` to control when brian wakes up. The framework ships with `PeriodicWake` — a timer with configurable backoff. Brian can also control its own schedule via the built-in `set_wake_interval` tool.

### Tools

Brian has three kinds of tools:

1. **Built-in** — memory (read/write/search) and wake interval control. Always available.
2. **Framework tools** — `bash` and `selfDeploy()`. Opt-in.
3. **MCP tools** — loaded from JSON configs. Any MCP-compatible server works.

Custom tools implement the `Tool` interface:

```typescript
const myTool: Tool = {
  name: 'my_tool',
  definition: {
    name: 'my_tool',
    description: 'Does something useful',
    parameters: { type: 'object', properties: { ... }, required: [...] },
  },
  async execute(input) {
    return 'result';
  },
};
```

### State

Brian stores state in `~/.brian/` (configurable via `stateDir`):

```
~/.brian/
├── MEMORY.md                     # Long-term knowledge
├── HEARTBEAT.md                  # Periodic checklist
├── memory/YYYY-MM-DD.md          # Daily logs
├── conversation-history.json     # Persistent conversation
└── logs/                         # Process logs
```

## How Contributions Flow

Each org forks this repo. The fork is a first-class, editable copy — not a read-only dependency.

When a brian identifies a generic improvement:

1. It makes the change in the org's fork
2. The improvement is live immediately for that org
3. It opens a PR from the fork to this upstream repo
4. Once merged, all forks benefit

The framework stays org-agnostic. Org-specific configuration belongs in your brian's project repo, not in the fork.

## License

MIT

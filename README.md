# Brian

Framework for autonomous AI coworkers. Brian is not a chatbot — it's the foundation for building persistent, autonomous agents that wake up, look around, decide what to do, and act.

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/grovina/brian/main/bootstrap.sh | bash
```

The bootstrap script forks this repo to your org, scaffolds your brian's project, and installs everything. You end up with two repos:

- **`your-org/brian`** — your fork of the framework (editable, stays in sync with upstream)
- **`your-org/brianna`** — your brian's implementation (name, instructions, MCP configs, deploy scripts)

## Usage

```typescript
import { Brian, AutonomousWake, bash, selfDeploy } from 'brian';
import { AnthropicModel } from 'brian/models/anthropic';
// or: import { VertexAIModel } from 'brian/models/vertex-ai';

const brian = new Brian({
  name: 'brianna',

  model: new AnthropicModel({
    apiKey: process.env.ANTHROPIC_API_KEY,
  }),

  wake: new AutonomousWake(),

  tools: [bash, selfDeploy()],

  mcp: './mcp/',
  instructions: './instructions.md',
});

await brian.start();
```

## Architecture

The repo has three parts: the **core runtime** (`src/`), the **module catalog** (`src/modules/`), and the **brian CLI** (`src/cli/`).

```text
src/
├── index.ts              # Public API
├── brian.ts              # Brian class — orchestrates everything
├── types.ts              # Core interfaces
├── agent.ts              # Model-agnostic agent loop
├── prompt.ts             # System prompt builder (reads context/)
├── memory.ts             # State: memory.md, conversation, logs
├── mcp.ts                # MCP server manager
├── logger.ts             # File + console logging
├── models/               # Model providers
│   ├── vertex-ai.ts      # Google Vertex AI (Gemini)
│   └── anthropic.ts      # Anthropic (Claude)
├── tools/                # Built-in tools
│   ├── bash.ts           # Shell execution
│   └── self-deploy.ts    # Self-deployment trigger
├── wake/                 # Wake strategies
│   └── autonomous.ts     # Model-driven autonomous scheduling
├── modules/              # Module catalog
│   ├── slack/            # Slack messaging (MCP)
│   ├── github/           # GitHub integration (MCP)
│   ├── updater/          # Fork update checker
│   ├── cursor/           # Cursor IDE CLI
│   └── claude/           # Claude Code CLI
└── cli/                  # brian CLI
    └── brian.ts          # Module management, sync, doctor
```

## What You Get

A brian built on this framework is a long-running process that:

- **Wakes up on a schedule** — checks communication channels, ongoing tasks, notifications
- **Acts autonomously** — uses tools (bash, MCP servers, memory) to get work done
- **Controls its own schedule** — decides when to wake up next based on context
- **Remembers across restarts** — persistent memory, auto-compacted conversation, activity logs
- **Improves itself** — can modify its own code, open PRs, and self-deploy

## Core Concepts

### Model Providers

Implement `ModelProvider` to add LLM backends. The catalog ships with:

- **`brian/models/vertex-ai`** — `VertexAIModel` (Gemini via Google Cloud)
- **`brian/models/anthropic`** — `AnthropicModel` (Claude via Anthropic API)

### Wake Strategies

Implement `WakeStrategy` to control when brian wakes up. Strategies can inject their own tools and prompt sections. The catalog ships with:

- **`brian/wake/autonomous`** — `AutonomousWake` — the model decides when to wake up next via a `sleep_until` tool

### Tools

Brian has three kinds of tools:

1. **Built-in** — memory (read/write/search) and wake strategy tools. Always available.
2. **Catalog tools** — `bash` and `selfDeploy()`. Import from `brian/tools`.
3. **MCP tools** — loaded from JSON configs. Any MCP-compatible server works.

### Modules

Modules are the collective knowledge of all brians — tested setup scripts for common integrations. Each module knows how to install itself, check its status, and write context that the daemon reads at wake time.

Modules are managed via the `brian` CLI:

```bash
brian module list              # see available modules
brian module install slack     # install a module
brian module check             # check all module status
brian doctor                   # full health check
brian sync                     # sync fork with upstream
brian sync --check             # check fork status only
```

Default modules (installed on `brian create`):

- **slack** — Slack messaging via MCP
- **github** — GitHub integration via MCP
- **updater** — monitors fork for upstream changes

Optional modules:

- **cursor** — Cursor IDE CLI detection and setup
- **claude** — Claude Code CLI installation and setup

Adding a new module is straightforward: create a directory under `src/modules/` with `check()` and `install()` functions. When a brian figures out how to set up something new, it contributes the module back to the repo.

### Context

The daemon reads all files from `~/.brian/context/` at every wake and includes them in the system prompt. Modules write context files here during install — this is how the agent learns about its available capabilities without any runtime hooks.

### State

Brian stores state in `~/.brian/` (configurable via `stateDir`):

```text
~/.brian/
├── memory.md              # Long-term knowledge (agent-curated)
├── conversation.json      # Conversation state with compacted summary
├── context/               # Dynamic wake-time context (module-managed)
│   ├── slack.md           # Written by slack module
│   ├── github.md          # Written by github module
│   ├── fork-status.md     # Written by updater module
│   └── ...
└── logs/
    └── YYYY-MM-DD.md      # Daily activity logs
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

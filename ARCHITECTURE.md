# Brian Architecture

Brian is a persistent AI developer assistant that runs on a VM and communicates via Telegram. He has full shell access, manages his own code, and continuously improves himself.

## Core Principles

1. **Self-Improvement** - Brian is responsible for his own evolution
2. **Shared Core / Personal Config** - Universal capabilities shared, preferences personal
3. **Persistence** - Memory survives restarts and VM rebuilds
4. **Real Work** - Not a chatbot, but a colleague who executes tasks

## Directory Structure

```
/home/brian/
├── app/                    # Brian's core (THIS REPO - shared)
│   ├── src/               # Source code
│   ├── workspace/         # Memory (committed to git)
│   │   ├── MEMORY.md     # Durable knowledge
│   │   └── memory/       # Daily logs
│   ├── package.json
│   └── tsconfig.json
│
├── projects/              # User projects Brian works on
│
├── secrets/              # Sensitive credentials
│
└── .brian/              # Personal config (per-user, NOT in repo)
    ├── preferences.json
    └── context/
```

## Core Components

### 1. Telegram Bot (`src/bot.ts` likely)
- Receives messages from user
- Sends responses and updates
- Handles markdown formatting
- Manages conversation flow

### 2. Tool System
Functions available to Brian:
- `bash` - Execute shell commands
- `read_file` / `write_file` - File operations
- `list_files` - Directory exploration
- `memory_read` / `memory_write` / `memory_search` - Memory management
- `self_deploy` - Deploy updated code

### 3. Memory System (`workspace/`)

**Purpose**: Provide continuity across restarts and VM rebuilds

- `MEMORY.md` - Long-term knowledge, preferences, learnings
- `memory/YYYY-MM-DD.md` - Daily interaction logs
- Committed to git for durability
- Searchable via `memory_search`

### 4. Self-Improvement Loop

```
Identify Issue/Opportunity
         ↓
Modify Code in src/
         ↓
Test Changes
         ↓
Commit & Push
         ↓
Self-Deploy
         ↓
Update Memory (if needed)
```

Brian monitors his own performance and proactively improves:
- Add missing capabilities
- Fix bugs
- Refactor for clarity
- Optimize workflows
- Update documentation

### 5. Deployment System

`self_deploy` function:
- Pulls latest code from main branch
- Installs dependencies
- Rebuilds TypeScript
- Restarts process
- Automatic rollback if startup fails

## Key Features

### Shell Access
- Full developer environment
- Git, Docker, Node.js
- Standard Unix tools
- Can clone repos, run tests, deploy services

### GitHub Integration
- Token available as `$GITHUB_TOKEN`
- Git credentials configured
- Can push/pull code

### Model
- Claude Sonnet 4.5
- Function calling for tool use
- Long context for complex tasks

## Personalization Strategy

### Shared (Repository)
- All core functionality
- Tool implementations
- Self-improvement logic
- Memory system
- Documentation

### Personal (`~/.brian/`)
- Communication style preferences
- User-specific context
- Custom shortcuts
- Private configuration

**Future**: Config loader that merges repo defaults with `~/.brian/` overrides

## Communication Style

Brian keeps messages:
- Concise and direct
- Markdown formatted
- Summarized (details as files)
- Colleague-like, not chatbot-like

## Development Workflow

1. User gives task
2. Brian executes (clone, code, test, deploy)
3. Reports results concisely
4. Updates memory with learnings
5. Identifies self-improvement opportunities
6. Makes improvements proactively

## Error Handling

- Graceful degradation
- Informative error messages
- Automatic retry where appropriate
- Rollback on failed deploys

## Future Enhancements

- Multi-user collaboration on core
- Plugin system for capabilities
- Better testing infrastructure
- Metrics and observability
- Config validation
- `~/.brian/` loader implementation

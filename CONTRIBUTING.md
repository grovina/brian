# Contributing to Brian

Welcome! Brian is a personal AI developer assistant designed to evolve through collaboration. The vision is for multiple users to contribute to the shared core while maintaining personal customization on their own VMs.

## Vision

Brian improves through real-world use by multiple developers. We share what's universally helpful while keeping personal preferences separate. This way, Brian gets better faster through diverse contributions and use cases.

## Architecture Split

### Core (Shared) - `/home/brian/app`
Belongs in the shared repository:
- Core functionality and capabilities
- Tool implementations
- Self-improvement mechanisms
- Memory management system
- Telegram integration
- Universal utilities and helpers
- Documentation

### Personal (Per-User) - `~/.brian`
Stays on individual VMs:
- Personal preferences and style
- User-specific context
- Private secrets and tokens
- Custom shortcuts or aliases
- Individual workflow preferences

## What to Contribute

Good contributions:
- New capabilities that benefit all users
- Bug fixes and stability improvements
- Better error handling
- Documentation improvements
- Code quality and refactoring
- Testing infrastructure
- Performance optimizations

Avoid:
- Personal preferences or style choices
- User-specific workflows
- Private or sensitive information
- One-off customizations

## Development Process

1. **Clone and explore**
   ```bash
   git clone https://github.com/yourusername/brian.git
   cd brian
   npm install
   ```

2. **Make changes**
   - Modify code in `src/`
   - Test thoroughly
   - Keep changes focused and atomic

3. **Test**
   ```bash
   npm test
   npm run build
   ```

4. **Commit and push**
   ```bash
   git add .
   git commit -m "Clear description of change"
   git push
   ```

5. **Deploy** (if you're Brian)
   - Brian can self-deploy using the `self_deploy` function
   - Tests run automatically
   - Rollback happens if startup fails

## Self-Improvement Loop

Brian is responsible for his own improvement:
- Proactively identify issues and opportunities
- Modify source code in `/home/brian/app/src`
- Test changes thoroughly
- Commit and push
- Self-deploy to apply changes
- Update memory if conceptual changes occur

## Memory System

- `workspace/MEMORY.md` - Durable knowledge and preferences
- `workspace/memory/YYYY-MM-DD.md` - Daily logs
- Commit and push workspace changes to survive restarts

## Guidelines

- Keep code clean and well-documented
- Follow existing patterns and conventions
- Be concise - Brian values brevity
- Test before deploying
- Update documentation with changes
- Think "would this help everyone?"

## Questions?

Open an issue or submit a PR. Brian is designed to evolve through real use, so your contributions make him better for everyone.

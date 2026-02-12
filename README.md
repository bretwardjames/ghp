# GHP - GitHub Projects Tools

A suite of tools for managing GitHub Projects from your terminal and editor.

| Tool | Install |
|------|---------|
| **VS Code / Cursor Extension** | [Marketplace](https://marketplace.visualstudio.com/items?itemName=bretwardjames.gh-projects) \| [Open VSX](https://open-vsx.org/extension/bretwardjames/gh-projects) |
| **CLI** | `npm install -g @bretwardjames/ghp-cli` |
| **Neovim Plugin** | [ghp.nvim](https://github.com/bretwardjames/ghp.nvim) |

All tools share the same core library and are designed to work together.

## A Note from Bret

This project was _entirely_ vibe coded with Claude. I just know how I want it to work and tell it what to do (like a good little vibe coder). Suggestions, contributions, etc are welcome!

## Quick Start

### CLI

```bash
# Install
npm install -g @bretwardjames/ghp-cli

# Authenticate
ghp auth

# View your assigned work
ghp work

# View project board
ghp plan

# Start working on an issue (creates branch, updates status)
ghp start 123
```

### VS Code / Cursor Extension

1. Install from the marketplace (search "GitHub Projects")
2. Open a folder with a git repository linked to GitHub Projects
3. Click the GitHub Projects icon in the activity bar
4. Sign in when prompted

## Features

### Shared Across All Tools

- **Branch Linking** - Link branches to issues, track active work
- **Workflow Automation** - "Start Working" creates branches and updates status
- **Project Board Views** - See boards exactly as configured on GitHub
- **Issue Templates** - Create issues using your repo's templates

### CLI-Specific

```bash
ghp work                      # View your assigned items
ghp plan                      # View project board
ghp plan --slice Priority=High # Filter by any field
ghp plan bugs                 # Use configured shortcuts
ghp add "Fix login bug"       # Create issue
ghp add "Title" --parent 42   # Create sub-issue
ghp move 123 "In Review"      # Change status
ghp done 123                  # Mark complete
ghp label 123 bug urgent      # Manage labels
ghp set-parent 123 --parent 42 # Set parent issue
ghp progress 42               # Show epic progress
ghp standup                   # Daily activity summary
ghp standup --since 2d --mine # Last 2 days, my issues only
```

**Shortcuts** - Define named filter combinations in config:
```json
{
  "shortcuts": {
    "bugs": { "status": "Backlog", "slice": ["type=Bug"] }
  }
}
```

### Parallel Work Mode (Worktrees)

Work on multiple issues simultaneously using git worktrees:

```bash
ghp start 123 --parallel      # Create worktree instead of switching
ghp switch 456 --parallel     # Open existing issue in worktree
ghp worktree list             # List all active worktrees
ghp worktree remove 123       # Clean up worktree when done
```

Each worktree gets automatic setup: copies `.env` files and runs your install command.

### AI-Assisted Features

```bash
ghp add "Fix login" --ai           # Expand brief title into full issue
ghp add epic "Auth system" --ai    # Break down epic into actionable issues
ghp pr --ai-description            # Generate PR description from changes
```

### Branch Dashboard

View comprehensive branch changes with optional external hook integration:

```bash
ghp dashboard                 # Full dashboard (commits, files, stats)
ghp dashboard --diff          # Show full unified diff
ghp dashboard --commits       # Commit history only
ghp dashboard --files         # Changed files only
ghp dashboard --json          # JSON output for scripts/tools
```

**Dashboard Hooks** - Integrate external tools (AI context, test results, etc.):

```bash
ghp dashboard hooks list      # List registered hooks
ghp dashboard hooks add <name> --command <cmd>  # Register hook
ghp dashboard hooks enable/disable <name>       # Toggle hooks
```

See [docs/hooks/README.md](docs/hooks/README.md) for the full hook API.

### Agent Management

Manage Claude agents in parallel worktrees:

```bash
ghp agents list               # List running agents
ghp agents watch              # Real-time dashboard
ghp agents stop --all         # Stop all agents
```

### MCP Server (AI Assistants)

Use GitHub Projects with Claude Desktop or other MCP-compatible AI assistants:

```bash
ghp mcp --install             # Auto-configure Claude Desktop
```

See [@bretwardjames/ghp-mcp](https://github.com/bretwardjames/ghp/tree/main/packages/mcp) for details.

### Extension-Specific

- **Drag and Drop** - Move issues between columns
- **Planning Board** - Full-screen kanban view
- **Multi-Select** - Bulk operations
- **Settings Sync** - Sync settings with CLI bidirectionally

## Configuration

Both CLI and extension share configuration concepts and can sync settings.

### CLI Configuration

```bash
ghp config --show          # View all settings
ghp config                 # Edit user config
ghp config -w              # Edit workspace config (shared with team)
ghp config sync            # Sync with VS Code/Cursor
```

**Config files:**
- User: `~/.config/ghp-cli/config.json`
- Workspace: `.ghp/config.json` (commit this)

### All Configuration Options

These options work in both CLI config and VS Code settings (with `ghProjects.` prefix):

| Option | Default | Description |
|--------|---------|-------------|
| `mainBranch` | `"main"` | Main branch name |
| `branchPattern` | `"{user}/{number}-{title}"` | Branch naming pattern. Tokens: `{user}`, `{number}`, `{title}` |
| `startWorkingStatus` | `"In Progress"` | Status when starting work on an issue |
| `doneStatus` | `"Done"` | Status when marking issue as done |
| `worktreePath` | `"~/.ghp/worktrees"` | Base directory for parallel worktrees |
| `worktreeCopyFiles` | `[".env", ".env.local"]` | Files to copy from main repo to new worktrees |
| `worktreeSetupCommand` | `"pnpm install"` | Command to run in new worktrees |
| `worktreeAutoSetup` | `true` | Automatically run setup in new worktrees |
| `shortcuts` | `{}` | Named filter combinations for `ghp plan` |

### Settings Sync

Keep CLI and extension in sync:

```bash
# From CLI
ghp config sync

# From VS Code
# Command Palette: "GitHub Projects: Sync Settings with CLI"
```

## Requirements

- Node.js >= 18
- GitHub account with Projects access
- VS Code 1.85+ or Cursor (for extension)

## Repository Structure

```
packages/
  core/     # @bretwardjames/ghp-core - Shared library
  cli/      # @bretwardjames/ghp-cli - Command-line tool
apps/
  vscode/   # gh-projects - VS Code extension
  nvim/     # ghp.nvim - Neovim plugin
```

## Contributing

Found a bug or have a feature request? [Open an issue](https://github.com/bretwardjames/ghp/issues).

## License

MIT

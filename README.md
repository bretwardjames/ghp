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
ghp move 123 "In Review"      # Change status
ghp done 123                  # Mark complete
```

**Shortcuts** - Define named filter combinations in config:
```json
{
  "shortcuts": {
    "bugs": { "status": "Backlog", "slice": ["type=Bug"] }
  }
}
```

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

### Extension Settings

Settings are in VS Code settings under "GitHub Projects" (`ghProjects.*`).

| Setting | Default | Description |
|---------|---------|-------------|
| `mainBranch` | `"main"` | Main branch name |
| `branchNamePattern` | `"{user}/{number}-{title}"` | Branch naming pattern |
| `startWorkingStatus` | `"In Progress"` | Status when starting work |
| `prMergedStatus` | `"Done"` | Status when PR is merged |

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

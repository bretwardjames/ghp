# @bretwardjames/ghp-cli

GitHub Projects CLI - manage project boards from your terminal.

Part of the [GHP monorepo](https://github.com/bretwardjames/ghp). Works alongside the [VS Code/Cursor extension](https://github.com/bretwardjames/ghp/tree/main/apps/vscode) for a complete GitHub Projects workflow.

## Installation

```bash
npm install -g @bretwardjames/ghp-cli
```

## Quick Start

```bash
# Authenticate with GitHub
ghp auth

# View your assigned items
ghp work

# View project board
ghp plan

# Start working on an issue
ghp start 123
```

## Commands

### Views

```bash
ghp work                       # Your assigned items
ghp work --status "In Progress"
ghp work --group priority      # Group by field

ghp plan                       # Project board
ghp plan --mine                # Only my items
ghp plan --slice type=Bug      # Filter by field
ghp plan bugs                  # Use configured shortcut
```

### Issue Management

```bash
ghp add "Issue title"          # Create issue
ghp add -t bug_report          # Use specific template
ghp open 123                   # View issue details
ghp open 123 --browser         # Open in browser
ghp edit 123                   # Edit in $EDITOR
ghp comment 123 -m "message"   # Add comment
```

### Workflow

```bash
ghp start 123                  # Create branch, update status
ghp done 123                   # Mark as done
ghp move 123 "In Review"       # Change status
ghp assign 123 @username       # Assign users
```

### Branch Management

```bash
ghp switch 123                 # Switch to issue's branch
ghp link-branch 123            # Link current branch to issue
ghp unlink-branch 123          # Unlink branch
ghp sync                       # Sync active label with branch
```

## Configuration

```bash
ghp config --show              # View all settings
ghp config                     # Edit user config
ghp config -w                  # Edit workspace config (shared)
ghp config sync                # Sync with VS Code/Cursor
```

## MCP Server (Claude Desktop)

Configure the ghp MCP server for use with Claude Desktop:

```bash
ghp mcp --install              # Auto-configure Claude Desktop
ghp mcp --config               # Show config JSON to copy manually
```

**Config files:**
- User: `~/.config/ghp-cli/config.json`
- Workspace: `.ghp/config.json` (commit this)

### Example Config

```json
{
  "mainBranch": "main",
  "branchPattern": "{user}/{number}-{title}",
  "startWorkingStatus": "In Progress",
  "doneStatus": "Done",
  "shortcuts": {
    "bugs": { "status": "Backlog", "slice": ["type=Bug"] }
  }
}
```

## Requirements

- Node.js >= 18
- GitHub account with Projects access

## License

MIT

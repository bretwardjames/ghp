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

### Authentication

```bash
ghp auth                       # Check authentication status
ghp auth --status              # Display auth status and setup guide
```

### Viewing Work

```bash
ghp work                       # Your assigned items
ghp work --all                 # All items (not just yours)
ghp work --status "In Progress" # Filter by status
ghp work --hide-done           # Hide completed items
ghp work --group priority      # Group by field
ghp work --sort -priority      # Sort (prefix - for descending)
ghp work --slice type=Bug      # Filter by field value
ghp work --list                # Simple list format
ghp work --flat                # Flat table format
```

```bash
ghp plan                       # Project board view
ghp plan --mine                # Only items assigned to you
ghp plan --unassigned          # Only unassigned items
ghp plan --status "Backlog"    # Filter by status (repeatable)
ghp plan --slice type=Bug      # Filter by field value (repeatable)
ghp plan --view "Sprint 1"     # Filter by project view
ghp plan --group status        # Group by field
ghp plan --sort priority       # Sort by field
ghp plan --all                 # Include done items
ghp plan --list                # Simple list format
ghp plan bugs                  # Use configured shortcut
```

```bash
ghp slice                      # Interactive field filtering
ghp slice -f Priority -v High  # Filter by specific field/value
ghp slice --list-fields        # List all available fields
```

### Issue Management

```bash
ghp add "Issue title"          # Create issue
ghp add "Title" --body "desc"  # With description
ghp add "Title" -e             # Open editor for body
ghp add "Title" --template bug_report  # Use specific template
ghp add --list-templates       # List available templates
ghp add "Title" --status "Backlog"     # Set initial status
ghp add "Title" --project "My Project" # Specify project
ghp add "Title" --force-defaults       # Non-interactive mode
```

```bash
ghp open 123                   # View issue details in terminal
ghp open 123 --browser         # Open in browser
```

```bash
ghp edit 123                   # Edit issue in $EDITOR
```

```bash
ghp comment 123                # Add comment (opens editor)
ghp comment 123 -m "message"   # Add comment inline
```

```bash
ghp move 123 "In Review"       # Change issue status
```

```bash
ghp set-field 123 Priority High  # Set any project field
```

```bash
ghp assign 123                 # Assign yourself
ghp assign 123 @user1 @user2   # Assign specific users
ghp assign 123 --remove @user  # Remove assignee
```

### Workflow

```bash
ghp start 123                  # Start working on issue
```

The `start` command:
- Creates or links a branch
- Updates issue status to "In Progress"
- Assigns you if not already assigned
- Applies the active label

**Options:**
| Option | Description |
|--------|-------------|
| `--parallel` | Create worktree instead of switching branches |
| `--worktree-path <path>` | Custom worktree location |
| `--branch-action <action>` | `create`, `link`, or `skip` |
| `--assign <action>` | `reassign`, `add`, or `skip` |
| `--from-main` | Create branch from main (when not on main) |
| `--force` | Proceed with uncommitted changes |
| `--force-defaults` | Non-interactive mode |

```bash
ghp done 123                   # Mark issue as done
```

Removes active label and offers to clean up worktree if one exists.

```bash
ghp pr                         # Show PR status for current branch
ghp pr 123                     # Show PR for specific issue
ghp pr --create                # Create PR for current branch
ghp pr --open                  # Open PR in browser
```

### Branch Management

```bash
ghp switch 123                 # Switch to issue's linked branch
ghp switch 123 --parallel      # Open in worktree instead
ghp switch 123 --worktree-path /custom/path
```

```bash
ghp link-branch 123            # Link current branch to issue
ghp link-branch 123 feature/x  # Link specific branch
```

```bash
ghp unlink-branch 123          # Remove branch link from issue
```

```bash
ghp sync                       # Sync active label with current branch
```

### Parallel Work Mode (Worktrees)

Work on multiple issues simultaneously:

```bash
ghp start 123 --parallel       # Create worktree for issue
ghp switch 456 --parallel      # Open existing issue in worktree
ghp worktree list              # List all active worktrees
ghp worktree remove 123        # Remove worktree for issue
ghp worktree remove 123 --force  # Force remove (uncommitted changes)
```

### Configuration

```bash
ghp config                     # Open config in editor
ghp config --show              # Display all settings with sources
ghp config -w                  # Edit workspace config (shared with team)
ghp config -u                  # Edit user config (personal)
ghp config sync                # Sync settings with VS Code/Cursor
```

### MCP Server

```bash
ghp mcp                        # Show MCP configuration
ghp mcp --config               # Show config JSON
ghp mcp --install              # Auto-configure Claude Desktop
```

## Configuration

**Config files:**
- User: `~/.config/ghp-cli/config.json`
- Workspace: `.ghp/config.json` (commit this for team settings)

Settings are merged: defaults → workspace → user (later overrides earlier).

### All Options

| Option | Default | Description |
|--------|---------|-------------|
| `mainBranch` | `"main"` | Main branch name |
| `branchPattern` | `"{user}/{number}-{title}"` | Branch naming. Tokens: `{user}`, `{number}`, `{title}` |
| `startWorkingStatus` | `"In Progress"` | Status when starting work |
| `doneStatus` | `"Done"` | Status when marking done |
| `worktreePath` | `"~/.ghp/worktrees"` | Base directory for worktrees |
| `worktreeCopyFiles` | `[".env", ".env.local"]` | Files copied to new worktrees |
| `worktreeSetupCommand` | `"pnpm install"` | Setup command for new worktrees |
| `worktreeAutoSetup` | `true` | Auto-run setup in new worktrees |
| `shortcuts` | `{}` | Named filter combinations |

### Example Config

```json
{
  "mainBranch": "main",
  "branchPattern": "{user}/{number}-{title}",
  "startWorkingStatus": "In Progress",
  "doneStatus": "Done",
  "worktreePath": "~/dev/worktrees",
  "worktreeCopyFiles": [".env", ".env.local", ".env.test"],
  "worktreeSetupCommand": "npm ci",
  "worktreeAutoSetup": true,
  "shortcuts": {
    "bugs": { "status": "Backlog", "slice": ["type=Bug"] },
    "mine": { "mine": true, "status": "In Progress" }
  }
}
```

## Requirements

- Node.js >= 18
- GitHub CLI (`gh`) authenticated, or `GITHUB_TOKEN` environment variable
- GitHub account with Projects access

## License

MIT

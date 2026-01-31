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
ghp work --json                # JSON output for scripts/AI tools
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
ghp plan --hide-done           # Exclude completed items
ghp plan --list                # Simple list format
ghp plan --json                # JSON output for scripts/AI tools
ghp plan bugs                  # Use configured shortcut
```

```bash
ghp slice                      # Interactive field filtering
ghp slice -f Priority -v High  # Filter by specific field/value
ghp slice --list-fields        # List all available fields
```

### Issue Management

```bash
# Create issues
ghp add "Issue title"                   # Create issue (shorthand)
ghp add issue "Issue title"             # Create issue (explicit)
ghp add issue "Title" --body "desc"     # With description
ghp add issue "Title" -e                # Open editor for body
ghp add issue "Title" --template bug    # Use specific template
ghp add issue "Title" --ai              # AI-expand brief title
ghp add issue "Title" --status "Backlog"     # Set initial status
ghp add issue "Title" --labels "bug,urgent"  # Apply labels
ghp add issue "Title" --assign          # Assign yourself
ghp add issue "Title" --parent 42       # Create as sub-issue

# Create epics
ghp add epic "Epic title"               # Create epic (issue with epic label)
ghp add epic "Auth system" --ai         # AI breakdown into sub-issues
ghp add epic "Title" --ai -x            # Execute AI plan (create issues)
ghp add epic "Title" --ai -c "context"  # Provide additional context

ghp add --list-templates                # List available templates
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

```bash
ghp label 123 bug urgent       # Add labels
ghp label 123 bug --remove     # Remove label
```

### Parent/Child Relationships (Sub-Issues)

```bash
ghp set-parent 123 --parent 42    # Set parent issue
ghp set-parent 123 --remove       # Remove parent
ghp progress 42                   # Show epic progress with sub-issues
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
ghp stop 123                   # Stop working on issue (keep in current status)
ghp stop                       # Stop working on current branch's issue
```

Removes active label without changing status. Useful when switching tasks.

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
ghp worktree list --json       # JSON output for scripts/AI tools
ghp worktree remove 123        # Remove worktree for issue
ghp worktree remove 123 --force  # Force remove (uncommitted changes)
```

### Branch Dashboard

View comprehensive branch changes with extensible hook system:

```bash
ghp dashboard                  # Full dashboard (commits, files, stats, hooks)
ghp dashboard --diff           # Show full unified diff
ghp dashboard --commits        # Commit history only
ghp dashboard --files          # Changed files only
ghp dashboard --stats          # Diff statistics only
ghp dashboard --json           # JSON output for scripts/tools
ghp dashboard --base main      # Compare against specific base branch
```

**Dashboard Hooks** - Integrate external tools (AI context, test results, etc.):

```bash
ghp dashboard hooks list                # List registered hooks
ghp dashboard hooks add <name>          # Register a new hook
  --command <cmd>                       # Command to execute
  --category <cat>                      # Category for grouping (optional)
  --display-name <name>                 # Display name (optional)
  --timeout <ms>                        # Timeout in milliseconds (default: 5000)
ghp dashboard hooks remove <name>       # Remove a hook
ghp dashboard hooks enable <name>       # Enable a hook
ghp dashboard hooks disable <name>      # Disable a hook
ghp dashboard hooks show <name>         # Show hook details
```

Hook commands receive `--branch` and `--repo` arguments and return JSON:
```json
{
  "success": true,
  "data": {
    "title": "Section Title",
    "items": [{ "label": "Item", "value": "Description" }]
  }
}
```

See [docs/hooks/README.md](../../docs/hooks/README.md) for the full hook API.

### Event Hooks

Integrate external tools by registering hooks that run on lifecycle events:

```bash
ghp hooks list                      # List registered hooks
ghp hooks add <name>                # Register a new hook
  --event <event>                   # Event: issue-created, issue-started, pr-created, pr-merged
  --command <cmd>                   # Shell command with ${var} templates
  --timeout <ms>                    # Timeout in milliseconds (default: 30000)
ghp hooks remove <name>             # Remove a hook
ghp hooks enable <name>             # Enable a hook
ghp hooks disable <name>            # Disable a hook
ghp hooks show <name>               # Show hook details
```

**Events and Template Variables:**

| Event | Trigger | Variables |
|-------|---------|-----------|
| `issue-created` | After `ghp add` | `${issue.number}`, `${issue.json}`, `${issue.title}`, `${repo}` |
| `issue-started` | After `ghp start` | `${issue.number}`, `${issue.json}`, `${branch}`, `${repo}` |
| `pr-created` | After `ghp pr --create` | `${pr.number}`, `${pr.json}`, `${branch}`, `${repo}` |
| `pr-merged` | After PR merge | `${pr.number}`, `${pr.json}`, `${branch}`, `${repo}` |

**Example: Ragtime Integration**

```bash
# Register hook to generate context when starting work
ghp hooks add ragtime-context \
  --event issue-started \
  --command "ragtime new-branch \${issue.number} --issue-json '\${issue.json}'"

# Now `ghp start 42` will:
# 1. Create/switch to branch
# 2. Run ragtime to generate context in .claude/memory/
```

### Agent Management

Manage Claude agents running in parallel worktrees:

```bash
ghp agents list                # List all running agents
ghp agents list --json         # JSON output for scripts/AI tools
ghp agents stop 123            # Stop agent for specific issue
ghp agents stop --all          # Stop all agents
ghp agents watch               # Real-time agent dashboard
```

### AI-Assisted Features

```bash
ghp add issue "Fix login" --ai    # Expand brief title into full issue
ghp add epic "Auth system" --ai   # Break down epic into sub-issues
ghp add epic "Title" --ai -x      # Execute plan (create issues)
ghp pr --ai-description           # Generate PR description from changes
```

> **Note:** `ghp plan-epic` is deprecated. Use `ghp add epic --ai` instead.

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

### Self-Update

```bash
ghp update                     # Update ghp packages to latest version
ghp update --check             # Check for updates without installing
ghp update --yes               # Skip prompts, update all packages
ghp update --beta              # Force update to beta versions
ghp update --stable            # Force update to stable versions
```

Auto-detects your current release channel (beta/stable) and updates accordingly.

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

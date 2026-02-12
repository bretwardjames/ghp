# GitHub Projects for VS Code

View and manage GitHub Project boards directly in VS Code and Cursor.

Part of the [GHP monorepo](https://github.com/bretwardjames/ghp). Works alongside the [ghp CLI](https://github.com/bretwardjames/ghp/tree/main/packages/cli) for a complete GitHub Projects workflow.

## Installation

- **VS Code**: [Marketplace](https://marketplace.visualstudio.com/items?itemName=bretwardjames.gh-projects)
- **Cursor**: [Marketplace](https://marketplace.visualstudio.com/items?itemName=bretwardjames.gh-projects) or [Open VSX](https://open-vsx.org/extension/bretwardjames/gh-projects)

## A Note from Bret

This project was _entirely_ vibe coded with Claude. I just know how I want it to work and tell it what to do (like a good little vibe coder). Suggestions, contributions, etc are welcome!

## Features

### Project Board Sidebar

See your GitHub Projects in the sidebar, organized exactly like on GitHub:
- **Board views** with columns based on your configured grouping
- **Table views** showing items in a list
- **Roadmap views** for timeline-based planning
- Filter to show only items assigned to you
- Active item indicator (green highlight) for issues you're currently working on

### Start Working Workflow

Click "Start Working" on any issue to:
1. Create a feature branch with configurable naming
2. Safety checks for uncommitted changes
3. Auto-switch to main branch and pull latest
4. Update issue status to "In Progress"
5. Assign yourself if not already assigned

Intelligently handles existing branches:
- If issue has a linked branch → switches to it
- If no linked branch → offers to create new or link existing

### Parallel Work Mode (Worktrees)

Work on multiple issues simultaneously without switching branches:

- **Start in Worktree** - Creates a git worktree for the issue
- **Open Worktree** - Opens existing worktree in a new window
- Automatic setup: copies `.env` files and runs install command
- **Descriptive directory names** - Worktrees use names like `271-fix-auth-bug`

### AI-Assisted Parallel Work

Seamless Claude integration for worktree-based development:

- **Auto-start Claude** - When opening a worktree, Claude starts automatically with issue context
- **Session resume** - Detects previous Claude sessions and offers to resume
- **Persistent context** - Worktree context survives window restarts
- **Manual trigger** - "Start Claude Session" command when you want to start later
- Works with Claude Code extension or falls back to integrated terminal

### Planning Board

Full-screen kanban view with:
- Visual drag-and-drop between columns
- Create new issues with template support
- Quick access to issue details
- Multi-select for bulk operations

### Branch Linking

- Link branches to issues manually or automatically
- Switch to linked branches from the sidebar
- Track which issues have active branches
- Active label sync across tools

### Settings Sync

Sync settings with the CLI:
- Command Palette: "GitHub Projects: Sync Settings with CLI"
- Compare and resolve conflicts interactively

### MCP Server

Configure Claude Desktop to work with your GitHub Projects:
- Command Palette: "GitHub Projects: Install MCP Server for Claude Desktop"

## Getting Started

1. Install the extension
2. Open a folder with a git repository linked to GitHub Projects
3. Click the GitHub Projects icon in the activity bar
4. Sign in when prompted

## Commands

Access via Command Palette (Cmd/Ctrl + Shift + P):

| Command | Description |
|---------|-------------|
| **GitHub Projects: Refresh** | Refresh the project board |
| **GitHub Projects: Start Working** | Start working on selected issue |
| **GitHub Projects: Start in Worktree** | Start issue in a parallel worktree |
| **GitHub Projects: Open Worktree** | Open existing worktree in new window |
| **GitHub Projects: Start Claude Session** | Start Claude in current worktree |
| **GitHub Projects: New Issue** | Create a new issue |
| **GitHub Projects: Open Planning Board** | Open full-screen kanban view |
| **GitHub Projects: Link Branch** | Link current branch to an issue |
| **GitHub Projects: Switch to Branch** | Switch to issue's linked branch |
| **GitHub Projects: Unlink Branch** | Remove branch link from issue |
| **GitHub Projects: Sync Settings with CLI** | Sync settings with ghp-cli |
| **GitHub Projects: Install MCP Server** | Configure Claude Desktop integration |
| **GitHub Projects: Open Standup Summary** | Show recent issue activity across the board |
| **GitHub Projects: Refresh Standup** | Refresh the standup panel |
| **GitHub Projects: Show Hidden Views** | Restore hidden sidebar views |

## Settings

### Display

| Setting | Default | Description |
|---------|---------|-------------|
| `ghProjects.showOnlyAssignedToMe` | `false` | Only show items assigned to you |
| `ghProjects.showEmptyColumns` | `false` | Show columns even when empty |
| `ghProjects.hiddenViews` | `[]` | View names to hide from sidebar |
| `ghProjects.planningModeViews` | `[]` | Views to show in Planning Board (empty = all) |
| `ghProjects.myStuffHiddenStatuses` | `["Done", "Closed"]` | Statuses to hide in My Stuff view |
| `ghProjects.showSwitchButton` | `true` | Show "Switch to Branch" button |

### Branches

| Setting | Default | Description |
|---------|---------|-------------|
| `ghProjects.mainBranch` | `"main"` | Main branch name |
| `ghProjects.branchNamePattern` | `"{user}/{number}-{title}"` | Branch naming pattern. Tokens: `{user}`, `{number}`, `{title}`, `{repo}` |
| `ghProjects.maxBranchNameLength` | `60` | Max branch name length (title truncated) |

### Workflow Status

| Setting | Default | Description |
|---------|---------|-------------|
| `ghProjects.startWorkingStatus` | `"In Progress"` | Status when starting work |
| `ghProjects.prOpenedStatus` | `"In Review"` | Status when PR is opened |
| `ghProjects.prMergedStatus` | `"Done"` | Status when PR is merged |

### Issues

| Setting | Default | Description |
|---------|---------|-------------|
| `ghProjects.allowBlankIssues` | `"auto"` | Allow blank issues: `auto`, `always`, `never` |
| `ghProjects.defaultIssueTemplate` | `""` | Default template (e.g., `bug_report`) |

### Worktrees

| Setting | Default | Description |
|---------|---------|-------------|
| `ghProjects.worktreePath` | `"~/.ghp/worktrees"` | Base directory for worktrees |
| `ghProjects.worktreeCopyFiles` | `[".env", ".env.local"]` | Files to copy to new worktrees |
| `ghProjects.worktreeSetupCommand` | `"pnpm install"` | Setup command for new worktrees |
| `ghProjects.worktreeAutoSetup` | `true` | Auto-run setup in new worktrees |

### Parallel Work (Claude Integration)

| Setting | Default | Description |
|---------|---------|-------------|
| `ghProjects.parallelWork.autoRunClaude` | `true` | Auto-start Claude in new worktree windows |
| `ghProjects.parallelWork.autoResume` | `true` | Detect and offer to resume previous sessions |
| `ghProjects.parallelWork.claudeCommand` | `"ghp-start"` | Claude slash command to run |

## Requirements

- VS Code 1.85+ or Cursor
- GitHub account with Projects access

## License

MIT

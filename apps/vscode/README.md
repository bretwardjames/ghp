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

### Start Working Workflow

Click "Start Working" on any issue to:
1. Create a feature branch with configurable naming
2. Safety checks for uncommitted changes
3. Auto-switch to main branch and pull latest
4. Update issue status to "In Progress"

### Planning Board

Full-screen kanban view with:
- Visual drag-and-drop between columns
- Create new issues with template support
- Quick access to issue details

### Branch Linking

- Link branches to issues manually or automatically
- Switch to linked branches from the sidebar
- Track which issues have active branches

### Settings Sync

Sync settings with the CLI:
- Command Palette: "GitHub Projects: Sync Settings with CLI"
- Compare and resolve conflicts interactively

## Getting Started

1. Install the extension
2. Open a folder with a git repository linked to GitHub Projects
3. Click the GitHub Projects icon in the activity bar
4. Sign in when prompted

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ghProjects.showOnlyAssignedToMe` | `false` | Only show items assigned to you |
| `ghProjects.mainBranch` | `"main"` | Your main branch name |
| `ghProjects.branchNamePattern` | `"{user}/{number}-{title}"` | Branch naming pattern |
| `ghProjects.startWorkingStatus` | `"In Progress"` | Status when starting work |
| `ghProjects.prMergedStatus` | `"Done"` | Status when PR is merged |

## Requirements

- VS Code 1.85+ or Cursor
- GitHub account with Projects access

## License

MIT

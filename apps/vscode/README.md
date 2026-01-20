# GitHub Projects for VS Code

View and manage GitHub Project boards directly in VS Code. This extension mirrors your project views exactly as configured on GitHub, bringing your kanban boards, tables, and roadmaps into your editor.

Part of the [GHP Tools](https://github.com/bretwardjames/ghp-core) suite. Works alongside the [ghp CLI](https://github.com/bretwardjames/ghp-cli) for a complete GitHub Projects workflow.

## Installation

**Quick install (extension + CLI):**
```bash
curl -fsSL https://raw.githubusercontent.com/bretwardjames/ghp-core/main/install.sh | bash
```

**Extension only:**
Download the `.vsix` from [releases](https://github.com/bretwardjames/vscode-gh-projects/releases) and install:
```bash
code --install-extension gh-projects-*.vsix
# or for Cursor:
cursor --install-extension gh-projects-*.vsix
```

### A note from Bret, the "Developer"

This project was _entirely_ vibe coded by Claude Code. I just know how I want it to work and told it what to do (like a good little vibe coder). Suggestions, contributions, etc are welcome!

## Features

### Project Board Sidebar

See your GitHub Projects in the VS Code sidebar, organized exactly like they are on GitHub:

- **Board views** with columns based on your configured grouping (Status, Priority, etc.)
- **Table views** showing items in a list format
- **Roadmap views** for timeline-based planning
- Filter to show only items assigned to you
- Hide views you don't need

### Start Working Workflow

Click "Start Working" on any issue to:

1. **Create a feature branch** with a configurable naming pattern
2. **Safety checks** - warns if you have uncommitted changes or are behind origin
3. **Auto-switch** to your main branch and pull latest if needed
4. **Update status** - automatically moves the issue to your configured "In Progress" status

### Planning Board

Open a full planning board view with:

- Visual kanban-style board
- Create new issues with template support
- Quick access to issue details

### Drag and Drop

Drag issues between status groups in the sidebar to quickly change their status. Multi-select supported for bulk moves.

### Branch Linking

- Link branches to issues manually or automatically
- Switch to linked branches directly from the sidebar
- Track which issues have active branches

### Settings Sync

Sync settings bidirectionally with the [ghp CLI](https://github.com/bretwardjames/ghp-cli):

- Command Palette: "GitHub Projects: Sync Settings with CLI"
- Compare settings and resolve conflicts interactively
- Choose per-setting: use VS Code value, CLI value, or enter custom
- Keeps both tools in sync without manual copying

## Requirements

- VS Code 1.85.0 or higher
- GitHub account with access to GitHub Projects
- Repository with linked GitHub Projects (repo-level or organization-level)

## Getting Started

1. Install the extension
2. Open a folder containing a git repository linked to GitHub
3. Click the GitHub Projects icon in the activity bar
4. Sign in when prompted (uses VS Code's built-in GitHub authentication)
5. Your project boards will appear in the sidebar

## Extension Settings

### Display Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ghProjects.showOnlyAssignedToMe` | `false` | Only show items assigned to you |
| `ghProjects.hiddenViews` | `[]` | List of view names to hide (e.g., `["Roadmap", "Archive"]`) |
| `ghProjects.showEmptyColumns` | `false` | Show columns even when they have no items |
| `ghProjects.myStuffHiddenStatuses` | `["Done", "Closed"]` | Statuses to hide in sidebar view |

### Branch Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ghProjects.mainBranch` | `"main"` | Your main/master branch name |
| `ghProjects.branchNamePattern` | `"{user}/{number}-{title}"` | Pattern for new branches. Variables: `{user}`, `{number}`, `{title}`, `{repo}` |
| `ghProjects.maxBranchNameLength` | `60` | Maximum length for generated branch names |

### Workflow Automation

| Setting | Default | Description |
|---------|---------|-------------|
| `ghProjects.startWorkingStatus` | `"In Progress"` | Status to set when clicking "Start Working" |
| `ghProjects.prOpenedStatus` | `"In Review"` | Status to set when a PR is opened |
| `ghProjects.prMergedStatus` | `"Done"` | Status to set when a PR is merged |

### Issue Creation

| Setting | Default | Description |
|---------|---------|-------------|
| `ghProjects.defaultIssueTemplate` | `""` | Default template for new issues (e.g., `"bug_report"`, `"feature_request"`) |
| `ghProjects.allowBlankIssues` | `"auto"` | Allow blank issues: `"auto"` (respect repo config), `"always"`, or `"never"` |

## Commands

| Command | Description |
|---------|-------------|
| `GitHub Projects: Sign In to GitHub` | Authenticate with GitHub |
| `GitHub Projects: Refresh` | Refresh project data |
| `GitHub Projects: Start Working` | Create branch and start working on an issue |
| `GitHub Projects: Move to...` | Change an item's status |
| `GitHub Projects: Open in Browser` | Open issue/PR in browser |
| `GitHub Projects: Open Planning Board` | Open the visual planning board |
| `GitHub Projects: New Issue` | Create a new issue |
| `GitHub Projects: Link Branch` | Link a branch to an issue |
| `GitHub Projects: Switch to Branch` | Switch to an issue's linked branch |
| `GitHub Projects: Settings` | Open extension settings |

## How It Works

This extension uses GitHub's GraphQL API to fetch your Projects (V2) data. It:

1. Detects your repository from the git remote
2. Finds all GitHub Projects linked to that repository
3. Fetches views, fields, and items from each project
4. Displays them in a tree structure matching your GitHub configuration

Authentication is handled through VS Code's built-in GitHub authentication provider, so you don't need to manage tokens manually.

## Privacy & Permissions

This extension requires the following GitHub OAuth scopes:

- `repo` - To read repository and issue data
- `project` - To read and update GitHub Projects

No data is sent to any third-party servers. All communication is directly between VS Code and GitHub's API.

## Known Issues

- Organization-level projects require you to have access to the organization
- SSO-protected organizations require token authorization at github.com/settings/connections/applications

## Contributing

Found a bug or have a feature request? Please open an issue on [GitHub](https://github.com/bretwardjames/vscode-gh-projects/issues).

## Related

- [ghp-core](https://github.com/bretwardjames/ghp-core) - Shared library and install script
- [ghp-cli](https://github.com/bretwardjames/ghp-cli) - Command-line interface for GitHub Projects

## License

MIT License - see [LICENSE](LICENSE) for details.

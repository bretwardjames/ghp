# GHP Tools

A suite of tools for managing GitHub Projects from your terminal and editor.

## What's Included

| Package | Description |
|---------|-------------|
| **[@bretwardjames/ghp-cli](https://github.com/bretwardjames/ghp-cli)** | Command-line interface for GitHub Projects |
| **[vscode-gh-projects](https://github.com/bretwardjames/vscode-gh-projects)** | VS Code / Cursor extension with visual boards |
| **@bretwardjames/ghp-core** | Shared library (this package) |

Both the CLI and extension share the same underlying library and are designed to work together.

## Quick Install

Install both the CLI and VS Code/Cursor extension with a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/bretwardjames/ghp-core/main/install.sh | bash
```

This will:
1. Install the `ghp` CLI globally via npm
2. Install the VS Code/Cursor extension from the latest release

### Manual Installation

**CLI only:**
```bash
npm install -g @bretwardjames/ghp-cli
```

**Extension only:**
Download the `.vsix` from [releases](https://github.com/bretwardjames/vscode-gh-projects/releases) and install:
```bash
code --install-extension gh-projects-*.vsix
# or for Cursor:
cursor --install-extension gh-projects-*.vsix
```

## Getting Started

1. Authenticate with GitHub:
   ```bash
   ghp auth
   ```

2. View your assigned work:
   ```bash
   ghp work
   ```

3. Open VS Code/Cursor and find the GitHub Projects panel in the sidebar

## Features

### Shared Across Both Tools

- **Branch Linking** - Link branches to issues, track which issues have active work
- **Workflow Automation** - "Start Working" creates branches and updates status
- **Project Board Views** - See your boards exactly as configured on GitHub
- **Issue Templates** - Create issues using your repo's templates

### CLI-Specific

- **Shortcuts** - Define named filter combinations (`ghp plan bugs`)
- **Slice Filters** - Filter by any field (`--slice Priority=High`)
- **Workspace Config** - Share settings with your team via `.ghp/config.json`
- **Simple List Output** - Integration with fzf, rofi, and other pickers

### Extension-Specific

- **Drag and Drop** - Move issues between columns visually
- **Planning Board** - Full-screen kanban view
- **Multi-Select** - Bulk operations on multiple items
- **Real-Time Sync** - Stay in sync with GitHub

## Configuration

Both tools share the same configuration concepts. The CLI uses JSON files, the extension uses VS Code settings.

### CLI Configuration (ghp-cli)

```bash
# View all settings with their sources
ghp config --show

# Edit user config (opens $EDITOR)
ghp config

# Edit workspace config (shared with team)
ghp config -w

# Set individual value
ghp config mainBranch develop
```

**Config files:**
- User: `~/.config/ghp-cli/config.json` (personal overrides)
- Workspace: `.ghp/config.json` (committed, shared with team)

Merge order: defaults -> workspace -> user

### Extension Configuration (VS Code)

Settings are in VS Code's settings UI under "GitHub Projects", or in your workspace `.vscode/settings.json`.

## Links

- [ghp-cli Documentation](https://github.com/bretwardjames/ghp-cli)
- [VS Code Extension Documentation](https://github.com/bretwardjames/vscode-gh-projects)
- [Report Issues](https://github.com/bretwardjames/ghp-core/issues)

## Requirements

- Node.js >= 18
- GitHub account with Projects access
- VS Code 1.85+ or Cursor (for extension)

## License

MIT

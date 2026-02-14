# @bretwardjames/ghp-mcp

MCP server for GitHub Projects - exposes GitHub Projects functionality to AI assistants via the [Model Context Protocol](https://modelcontextprotocol.io).

Part of the [GHP monorepo](https://github.com/bretwardjames/ghp). Works alongside the [CLI](https://github.com/bretwardjames/ghp/tree/main/packages/cli) and [VS Code extension](https://github.com/bretwardjames/ghp/tree/main/apps/vscode).

## Installation

```bash
npm install -g @bretwardjames/ghp-mcp
```

## Configuration

### Quick Setup (Recommended)

**From CLI:**
```bash
ghp mcp --install
```

**From VS Code/Cursor:**
Open Command Palette → "GitHub Projects: Install MCP Server for Claude Desktop"

Both methods automatically configure Claude Desktop for you.

### Manual Configuration

If you prefer to configure manually, add this to your Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ghp": {
      "command": "ghp-mcp"
    }
  }
}
```

Or with npx (no global install required):

```json
{
  "mcpServers": {
    "ghp": {
      "command": "npx",
      "args": ["@bretwardjames/ghp-mcp"]
    }
  }
}
```

After configuring, restart Claude Desktop to load the MCP server.

### Authentication

The server uses the same GitHub authentication as the CLI. Run `ghp auth` to authenticate, or set a `GITHUB_TOKEN` environment variable.

## Tools

### Default Tools (Always Enabled)

| Tool | Description |
|------|-------------|
| `get_my_work` | View items assigned to you |
| `get_project_board` | View project board/items (with optional status/assignee filters) |
| `create_issue` | Create a new issue and add to project |
| `update_issue` | Update an issue's title and/or body |
| `move_issue` | Move an issue to a different status |
| `mark_done` | Mark an issue as done |
| `start_work` | Start working on an issue (supports `hotfix` param for branching from tags) |
| `create_worktree` | Create a worktree for parallel development |
| `get_fields` | List all project fields and their valid values |
| `get_tags` | List git tags sorted newest first (for hotfix discovery) |
| `assign_issue` | Assign users to an issue |
| `add_comment` | Add a comment to an issue |
| `set_field` | Set a field value on an issue |

### Opt-in Tools (Disabled by Default)

These tools are available but disabled by default to keep the tool set lean. Enable them via configuration (see below).

| Tool | Description |
|------|-------------|
| `create_pr` | Create a pull request for the current branch |
| `merge_pr` | Merge a pull request (squash/merge/rebase) |
| `list_worktrees` | List all active git worktrees |
| `remove_worktree` | Remove a git worktree |
| `stop_work` | Stop working on an issue (removes active label) |
| `set_parent` | Set or remove parent issue (sub-issues) |
| `add_label` | Add a label to an issue |
| `remove_label` | Remove a label from an issue |
| `get_progress` | Get progress summary for an epic/parent issue |
| `link_branch` | Link a git branch to an issue |
| `unlink_branch` | Remove branch link from an issue |
| `get_issue` | Get full issue details with relationships |

### Enabling Opt-in Tools

Add to your config file (`~/.config/ghp-cli/config.json`):

```json
{
  "mcp": {
    "enabledTools": ["create_pr", "merge_pr", "list_worktrees"]
  }
}
```

Or in your workspace config (`.ghp/config.json`) for project-specific tools.

### Example Usage

```
AI: "Show me my current work items"
→ Uses the `get_my_work` tool

AI: "Create a bug report for the login timeout issue"
→ Uses `create_issue` with appropriate title/body

AI: "Move issue 42 to In Review"
→ Uses `move` tool

AI: "Start working on issue 15"
→ Uses `start` tool (creates branch, updates status)
```

## Resources

| Resource | Description |
|----------|-------------|
| `work://items` | Your assigned work items |
| `plan://board` | Full project board view |
| `issue://{number}` | Single issue details |
| `projects://list` | Available projects |

## Requirements

- Node.js >= 18
- GitHub account with Projects access
- `ghp auth` completed or `GITHUB_TOKEN` environment variable

## License

MIT

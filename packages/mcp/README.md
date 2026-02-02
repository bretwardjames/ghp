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

| Tool | Description |
|------|-------------|
| `get_my_work` | View items assigned to you |
| `get_project_board` | View project board/items (with optional status/assignee filters) |
| `create_issue` | Create a new issue and add to project |
| `update_issue` | Update an issue's title and/or body |
| `move` | Move an issue to a different status |
| `done` | Mark an issue as done |
| `start` | Start working on an issue |
| `create_worktree` | Create a worktree for parallel development |
| `assign` | Assign users to an issue |
| `comment` | Add a comment to an issue |
| `set_field` | Set a field value on an issue |

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

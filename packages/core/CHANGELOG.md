# @bretwardjames/ghp-core

## 0.2.0-beta.3

### Minor Changes

- adding worktree functions

## 0.2.0-beta.2

### Minor Changes

- **Descriptive worktree path generation** - `generateWorktreePath` now accepts optional title for names like `271-fix-auth-bug`

## 0.2.0-beta.1

### Minor Changes

- Add parallel work mode with git worktrees

  - `ghp start <issue> --parallel` creates worktree instead of switching branches
  - `ghp switch <issue> --parallel` same for switch command
  - `ghp worktree list` and `ghp worktree remove <issue>` commands
  - Automatic worktree setup: copies .env files, runs install command
  - Active label protection for issues with active worktrees
  - VS Code extension support with "Start in Worktree" command
  - Cleanup prompts when marking issues as done

## 0.2.0-beta.0

### Minor Changes

- Adds non-interactive support for CLI commands, as well as a full MCP server for configuring AI agents to work directly with the CLI.

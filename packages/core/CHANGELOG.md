# @bretwardjames/ghp-core

## 0.2.0-beta.9

### Patch Changes

- feat(cli): add stop command, auto-apply epic label, fix progress display
  feat(vscode): show issue number before title in sidebar
  fix(progress): count CLOSED sub-issues as completed

## 0.2.0-beta.8

### Patch Changes

- feat(cli): add --json output option to list commands

  - `ghp work --json` - list assigned items as JSON
  - `ghp plan --json` - list project items as JSON
  - `ghp worktree list --json` - list worktrees as JSON
  - `ghp agents list --json` - list running agents as JSON

  Also includes:

  - `--hide-done` filter support for `ghp plan`
  - Silent check-coordination hook to prevent settings.local.json corruption
  - gh→ghp command mapping documentation in CLAUDE.md

## 0.2.0-beta.7

### Minor Changes

- **Branch Dashboard** - Comprehensive view of branch changes with extensible hook system

  - `ghp dashboard` - Show commits, file changes, and diff stats for current branch
  - `ghp dashboard --diff` - Show full unified diff
  - `ghp dashboard --commits` - Show commit history only
  - `ghp dashboard --files` - Show changed files only
  - `ghp dashboard --stats` - Show diff statistics only
  - `ghp dashboard --json` - Output in JSON format for programmatic use
  - `ghp dashboard --base <branch>` - Compare against specific base branch

  **Dashboard Hooks** - Extensible system for external content providers

  - `ghp dashboard hooks list` - List registered hooks
  - `ghp dashboard hooks add <name>` - Register a new hook
  - `ghp dashboard hooks remove <name>` - Remove a hook
  - `ghp dashboard hooks enable/disable <name>` - Toggle hooks
  - `ghp dashboard hooks show <name>` - Show hook details
  - Hooks receive `--branch` and `--repo` args, return JSON response
  - Hook results displayed in dashboard grouped by category

  **VS Code Extension** - Dashboard panel integration

  - "Open Dashboard" command to view branch changes in webview
  - Tabs for Files Changed, Commits, and Full Diff views
  - External Changes section for hook data
  - Refresh command to update dashboard data

  **Neovim Plugin** - Dashboard buffer with keymaps

  - `:GhpDashboard` - Open dashboard in split
  - `:GhpDashboardFloat` - Open in floating window
  - Buffer keymaps: `<CR>` open file, `d` show diff, `c` commits, `r` refresh, `q` close

## 0.2.0-beta.6

### Patch Changes

- 9db9db9: Fix pagination bug causing projects with >100 items to be incomplete. Add direct issue lookup optimization and issueNotInProject config option.

## 0.2.0-beta.5

### Minor Changes

- **Sub-issues API support**

  - `addSubIssue()` and `removeSubIssue()` mutations
  - `getIssueRelationships()` to fetch parent and sub-issues
  - GraphQL client with `sub_issues` feature header

- **Label management APIs**

  - `addLabelsToIssue()` and `removeLabelsFromIssue()` methods
  - Label lookup and creation utilities

- **Assignment helpers**
  - `checkAssignment()` utility to detect current user assignment status

### Patch Changes

- Fix: `getRepoRoot()` now correctly returns main repo path when running in worktrees

## 0.2.0-beta.4

### Minor Changes

- adding parallel worktree features

### Patch Changes

- 4544ce7: working our way toward version 2.1

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

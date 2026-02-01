# Changelog

## 0.3.0

### Minor Changes

- Add `--review` flag for PR review workflow

  - `ghp start 123 --review --parallel` creates a worktree without changing issue status, labels, or assignment
  - Useful for reviewing PRs without claiming the issue
  - Skips issue-started event hooks in review mode

## 0.2.1

### Patch Changes

- feat: Add event hooks system for external tool integration

  - Add `ghp hooks` commands to register shell commands that run on lifecycle events
  - Supported events: `issue-created`, `issue-started`, `pr-created`, `pr-merged`
  - Template variable substitution: `${issue.number}`, `${issue.json}`, `${branch}`, `${repo}`
  - Fire `issue-created` hooks after `ghp add`
  - Fire `issue-started` hooks after `ghp start`

  Example usage with ragtime:

  ```bash
  ghp hooks add ragtime-context \
    --event issue-started \
    --command "ragtime new-branch \${issue.number} --issue-json '\${issue.json}'"
  ```

- cdb9181: fix(cli): switch back to original branch after creating parallel worktree

  Previously, `ghp start --parallel` would switch back to `main` after creating a worktree. Now it returns to the branch you were on before running the command. Also adds a warning when starting from detached HEAD state.

- Updated dependencies
  - @bretwardjames/ghp-core@0.2.1

## 0.2.0

### Minor Changes

- 04cfa9e: feat(cli): add ghp update command for self-updating packages
- 150b7ef: feat(cli): add stop command, auto-apply epic label, fix progress display
  feat(vscode): show issue number before title in sidebar
  fix(progress): count CLOSED sub-issues as completed
- 2e0ec74: **Branch Dashboard** - Comprehensive view of branch changes with extensible hook system

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

### Patch Changes

- 9db9db9: Fix pagination bug causing projects with >100 items to be incomplete. Add direct issue lookup optimization and issueNotInProject config option.
- ebff9dc: feat(cli): add --json output option to list commands

  - `ghp work --json` - list assigned items as JSON
  - `ghp plan --json` - list project items as JSON
  - `ghp worktree list --json` - list worktrees as JSON
  - `ghp agents list --json` - list running agents as JSON

  Also includes:

  - `--hide-done` filter support for `ghp plan`
  - Silent check-coordination hook to prevent settings.local.json corruption
  - gh→ghp command mapping documentation in CLAUDE.md

- Updated dependencies [150b7ef]
- Updated dependencies [2e0ec74]
- Updated dependencies [9db9db9]
- Updated dependencies [ebff9dc]
  - @bretwardjames/ghp-core@0.2.0

## 0.2.0-beta.10

### Minor Changes

- feat(cli): add ghp update command for self-updating packages

## 0.2.0-beta.9

### Minor Changes

- feat(cli): add stop command, auto-apply epic label, fix progress display
  feat(vscode): show issue number before title in sidebar
  fix(progress): count CLOSED sub-issues as completed

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.2.0-beta.9

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

- Updated dependencies
  - @bretwardjames/ghp-core@0.2.0-beta.8

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

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.2.0-beta.7

## 0.2.0-beta.6

### Patch Changes

- 9db9db9: Fix pagination bug causing projects with >100 items to be incomplete. Add direct issue lookup optimization and issueNotInProject config option.
- Updated dependencies [9db9db9]
  - @bretwardjames/ghp-core@0.2.0-beta.6

## 0.2.0-beta.5

### Minor Changes

- **Parent/child issue relationships (sub-issues)**

  - `ghp set-parent <issue> --parent <parent>` to set parent issue
  - `ghp set-parent <issue> --remove` to remove parent
  - `ghp add-issue --parent <issue>` to create sub-issues directly
  - `ghp progress <issue>` to show epic progress with sub-issue status

- **Label management**

  - `ghp label <issue> <labels...>` to add labels
  - `ghp label <issue> <labels...> --remove` to remove labels

- **Enhanced issue creation**

  - `ghp add-issue --labels <labels>` to apply labels on create
  - `ghp add-issue --assign [users]` to assign users (empty for self)
  - `ghp add-issue --field <field=value>` to set project fields

- **Agent management for parallel work**

  - `ghp agents list` to view running Claude agents
  - `ghp agents stop [issue]` to stop specific agent
  - `ghp agents stop --all` to stop all agents
  - `ghp agents watch` for real-time agent dashboard

- **AI-assisted utilities**
  - `ghp add-issue --ai` to expand brief title into full issue description
  - `ghp plan-epic <title>` to break down epics into actionable issues
  - `ghp pr --ai-description` to generate PR descriptions from changes

### Patch Changes

- Fix: Workspace config (`.ghp/config.json`) now correctly loads from main repo when working in worktrees
- Updated dependencies
  - @bretwardjames/ghp-core@0.2.0-beta.5

## 0.2.0-beta.4

### Minor Changes

- adding parallel worktree features

### Patch Changes

- 4544ce7: working our way toward version 2.1
- Updated dependencies
- Updated dependencies [4544ce7]
  - @bretwardjames/ghp-core@0.2.0-beta.4

## 0.2.0-beta.3

### Minor Changes

- adding worktree functions

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.2.0-beta.3

## 0.2.0-beta.2

### Minor Changes

- **Descriptive worktree directory names** - Worktrees now use names like `271-fix-auth-bug` instead of just `271`
- **Auto-resume Claude sessions** - Detects previous Claude sessions in worktrees and offers to resume
- **Subagent spawning support** - `--parallel` mode includes context for spawned Claude agents

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.2.0-beta.2

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

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.2.0-beta.1

## 0.2.0-beta.0

### Minor Changes

- Adds non-interactive support for CLI commands, as well as a full MCP server for configuring AI agents to work directly with the CLI.

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.2.0-beta.0

## [0.1.7] - 2026-01-17

### Added

- **Layered configuration system** - Workspace config (`.ghp/config.json`) for team settings, user config for personal overrides
- **`ghp config sync`** - Import settings from VS Code/Cursor (`ghProjects.*` settings)
- **`ghp config --show`** - Display all settings with source indicators (default/workspace/user)
- **`ghp edit <issue>`** - Edit issue description in $EDITOR

### Changed

- `ghp config` now opens editor by default (use `--show` to view settings)
- `ghp config -w` targets workspace config, `-u` targets user config
- Full config display now shows defaults, shortcuts, and per-shortcut sources

### Fixed

- Handle `status` as array in plan command options

## [0.1.6] - 2026-01-16

### Added

- Branch linking with `ghp link-branch` and `ghp unlink-branch`
- `ghp sync` to sync active label with current branch
- `ghp switch` to switch to linked branch
- Branch column in table display

## [0.1.5] - 2026-01-15

### Added

- Initial release with core workflow commands

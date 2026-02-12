# Changelog

## 0.8.0

### Minor Changes

- 7789fab: Add `ghp standup` command for daily activity summary across CLI, MCP, and VS Code. Shows recent issue activity including comments, assignments, label changes, closures, and PR cross-references. Also fixes `ghp start --force-defaults` not auto-assigning the current user.

### Patch Changes

- Updated dependencies [7789fab]
  - @bretwardjames/ghp-core@0.7.0

## 0.7.1

### Patch Changes

- ## MCP Feature Parity Release

  ### @bretwardjames/ghp-mcp (minor)

  Added 12 new MCP tools for feature parity with CLI:

  **Opt-in tools (disabled by default):**

  - `create_pr` - Create pull requests
  - `merge_pr` - Merge pull requests (squash/merge/rebase)
  - `list_worktrees` - List active git worktrees
  - `remove_worktree` - Remove git worktrees
  - `stop_work` - Stop working on an issue
  - `set_parent` - Set/remove parent issue relationships
  - `add_label` - Add labels to issues
  - `remove_label` - Remove labels from issues
  - `get_progress` - Get epic/parent issue progress
  - `link_branch` - Link git branches to issues
  - `unlink_branch` - Remove branch links
  - `get_issue` - Get full issue details with relationships

  New tools use `disabledByDefault: true` to keep the default toolset lean. Enable via config:

  ```json
  {
    "mcp": {
      "enabledTools": ["create_pr", "merge_pr", "list_worktrees"]
    }
  }
  ```

  ### @bretwardjames/ghp-cli (patch)

  - Fixed `--no-template` flag not working in `ghp add` command
  - Fixed `--no-hooks` flag not working in `ghp pr --create` command

  ### @bretwardjames/ghp-core (patch)

  - Added `extractIssueNumberFromBranch` utility export
  - Added `OnFailureBehavior` type export

- Updated dependencies
  - @bretwardjames/ghp-core@0.6.1

## 0.7.0

### Minor Changes

- 3e202c9: Fix CLI flag collisions and add validation

  ## Breaking Changes: Short Flag Removals

  The following short flags have been removed to fix semantic collisions where the same letter had completely different meanings across commands:

  ### Critical Collisions Fixed

  | Removed | Long Form  | Command          | Reason                                               |
  | ------- | ---------- | ---------------- | ---------------------------------------------------- |
  | `-f`    | `--flat`   | `work`           | Conflicted with `--force` in 4 other commands        |
  | `-a`    | `--assign` | `add issue/epic` | Conflicted with `--all` in 4 other commands          |
  | `-c`    | `--create` | `pr`             | Conflicted with `--config`, `--context`, `--command` |
  | `-m`    | `--mine`   | `plan`           | Conflicted with `--message`, `--mode`                |

  ### High Severity Collisions Fixed

  | Removed | Long Form   | Command      | Reason                                    |
  | ------- | ----------- | ------------ | ----------------------------------------- |
  | `-t`    | `--type`    | `progress`   | Conflicted with `--template`, `--timeout` |
  | `-s`    | `--show`    | `config`     | Conflicted with `--status` in 3 commands  |
  | `-p`    | `--parent`  | `set-parent` | Conflicted with `--project` everywhere    |
  | `-b`    | `--browser` | `open`       | Conflicted with `--body`                  |

  ### Changed Short Flags

  | Old  | New  | Long Form  | Command          |
  | ---- | ---- | ---------- | ---------------- |
  | `-l` | `-L` | `--labels` | `add issue/epic` |

  ## Migration Guide

  Update any scripts or muscle memory:

  ```bash
  # Before → After
  ghp work -f          →  ghp work --flat
  ghp add -a user      →  ghp add --assign user
  ghp pr -c            →  ghp pr --create
  ghp plan -m          →  ghp plan --mine
  ghp progress -t Epic →  ghp progress --type Epic
  ghp config -s        →  ghp config --show
  ghp set-parent -p 1  →  ghp set-parent --parent 1
  ghp open 123 -b      →  ghp open 123 --browser
  ghp add -l bug       →  ghp add -L bug
  ```

  ## New Features: Flag Validation

  Commands now validate flag values and provide clear error messages:

  ### Enum Validation

  - `--branch-action` validates: `create`, `link`, `skip`
  - `--assign` (action mode) validates: `reassign`, `add`, `skip`
  - `--group` validates: `status`, `type`, `assignee`, `priority`, `size`, `labels`
  - `--mode` (event hooks) validates: `fire-and-forget`, `blocking`, `interactive`

  ### Mutual Exclusivity

  - `--squash` and `--rebase` cannot be used together (merge)
  - `--nvim`, `--claude`, `--terminal-only` are mutually exclusive (start/switch)

  ### Numeric Bounds

  - `--max-diff-lines` validates range 1-100000

  Example error messages:

  ```
  Error: Invalid value for --group: "invalid"
  Valid values: status, type, assignee, priority, size, labels

  Error: Flags --squash and --rebase cannot be used together
  These flags are mutually exclusive. Use only one.
  ```

### Patch Changes

- QA Checkpoint 2026-02-02

  ## @bretwardjames/ghp-core

  ### Security

  - Fix command injection vulnerabilities by using `spawn()` with array arguments instead of `exec()` with string interpolation
  - Add `shell-utils` module with `shellEscape()`, `validateNumericInput()`, `validateSafeString()`, `validateUrl()`

  ### Error Handling

  - Add `GitError` class that captures command, stderr, exitCode, and cwd for debugging
  - Remove silent catch blocks from git-utils functions - errors now propagate properly

  ### New Features

  - Add retry logic for transient GitHub API failures (`withRetry`, `isTransientError`, `calculateBackoffDelay`)
  - Add configurable hook failure behavior (`OnFailureBehavior`: 'fail-fast' | 'continue')
  - Support per-event hook settings via `eventDefaults` in event-hooks.json

  ### Bug Fixes

  - Fix repository field in GraphQL queries to return full `owner/repo` format

  ## @bretwardjames/ghp-cli

  ### New Features

  - Add centralized exit utility with cleanup handler support (`registerCleanupHandler`, `exit`)
  - Add validation module for enum flags, mutual exclusion, and numeric bounds

  ### Bug Fixes

  - Fix `deepMergeObjects` to recursively merge nested config at all depths
  - Fix type safety issues - replace `any` types with `SortableFieldValue` in sorting logic
  - Fix `planCommand` parameter type from `any` to `Command | PlanOptions`

  ### Documentation

  - Document all hook events (pre-pr, pr-creating) and template variables
  - Update create-pr command to mention committing ragtime branch context

  ### Test Coverage

  - Add 25 tests for CLI commands (start, add-issue)
  - Add 21 tests for exit utility
  - Add 34 tests for config operations
  - Add 33 tests for validation module

  ## @bretwardjames/ghp-mcp

  ### Security

  - Fix command injection in worktree operations

  ### Test Coverage

  - Add 9 tests for tool registry

- Updated dependencies
- Updated dependencies [fbe1b3c]
  - @bretwardjames/ghp-core@0.6.0

## 0.6.0

### Minor Changes

- 16c3603: Add `ghp merge` command with pr-merged hook support

  New command to merge PRs and fire the `pr-merged` event hook, enabling external tools to respond to PR merges (e.g., Ragtime graduating branch memories).

- c5b3627: Add hook execution modes (fire-and-forget, blocking, interactive)

  Hooks can now specify a `mode` that controls behavior on completion:

  - `fire-and-forget` (default): Silent execution, logged only, never aborts workflow
  - `blocking`: Shows output on failure, non-zero exit aborts workflow
  - `interactive`: Always shows output, prompts user to continue (y), abort (N), or view full output (v)

  New CLI options for `ghp hooks add`:

  - `--mode <mode>`: Set the execution mode
  - `--continue-prompt <text>`: Custom prompt text for interactive mode

  Hooks can also configure custom exit code classification via the `exitCodes` field in the config file.

- 25143fe: Fire PR lifecycle hooks in ghp pr command

  - Fire `pre-pr` hooks before PR creation (with changed files, diff stats)
  - Fire `pr-creating` hooks just before GitHub API call (with proposed title/body)
  - Fire `pr-created` hooks after successful creation
  - Add `--force` flag to bypass blocking hook failures
  - Add `--no-hooks` flag to skip all hooks
  - Hooks now fire from core workflow layer (available to MCP, VS Code, nvim)

### Patch Changes

- f0e69f8: Centralize hook firing in core workflows

  ## @bretwardjames/ghp-core (minor)

  - Add workflow layer with functions that combine operations + hook firing:

    - `createIssueWorkflow` - Create issue and fire `issue-created` hook
    - `startIssueWorkflow` - Start working on issue and fire `issue-started` hook
    - `createPRWorkflow` - Create PR and fire `pr-created` hook
    - `createWorktreeWorkflow` - Create worktree and fire `worktree-created` hook
    - `removeWorktreeWorkflow` - Remove worktree and fire `worktree-removed` hook

  - Add `cwd` option to hook executor for firing hooks from inside worktrees
  - Add tests for all workflow functions (24 tests)
  - Add vitest test runner

  ## @bretwardjames/ghp-cli (patch)

  - Hook firing order improved: `worktree-created` fires before `issue-started` in parallel mode
  - Hooks now fire from inside the worktree directory when using `--parallel`

  ## @bretwardjames/ghp-mcp (patch)

  - MCP `start` tool now fires `issue-started` hook
  - MCP `add-issue` tool now fires `issue-created` hook

  ## gh-projects (patch)

  - VS Code extension now fires `issue-started` hook when starting work
  - VS Code extension now fires `worktree-created` and `issue-started` hooks when creating worktrees
  - Hooks fire from inside the worktree directory for correct file placement

- c3a2ea3: fix(cli): include issue body in issue-started hook payload

  The `issue-started` event hook now includes the actual issue body instead of an empty string. This enables hooks to access the full issue description via `${issue.body}` or `${issue.json}` template variables.

  Relates to #217

- Updated dependencies [62b7941]
- Updated dependencies [16c3603]
- Updated dependencies [f0e69f8]
- Updated dependencies [3fce458]
- Updated dependencies [c5b3627]
- Updated dependencies [25143fe]
  - @bretwardjames/ghp-core@0.5.0

## 0.5.1

### Patch Changes

- Add worktree-created event to hooks help text

## 0.5.0

### Minor Changes

- Add worktree lifecycle events to hook system

  - New `worktree-created` event fires when a NEW worktree is created (not for existing ones)
  - Payload includes repo, issue, branch, and worktree path/name
  - Enables tools like ragtime to set up context for parallel worktrees

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.4.0

## 0.4.0

### Minor Changes

- b559617: Add worktree lifecycle events to hook system

  New events:

  - `worktree-created` - fires after `ghp start --parallel` creates a worktree
  - `worktree-removed` - fires after `ghp worktree remove` removes a worktree

  New template variables:

  - `${worktree.path}` - absolute path to the worktree
  - `${worktree.name}` - directory name of the worktree

  Example usage:

  ```bash
  ghp hooks add ts-funnel-up \
    --event worktree-created \
    --command "ts-magic up ${worktree.path}"
  ```

### Patch Changes

- Updated dependencies [b559617]
  - @bretwardjames/ghp-core@0.3.0

## 0.3.1

### Patch Changes

- Support PR number in review mode - resolves PR → issue via branch name

  - `ghp start 388 --review` now treats 388 as PR number (default)
  - Use `--issue` flag to treat as issue number directly
  - Prints resolution path: "PR #388 → branch "..." → issue #123"

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

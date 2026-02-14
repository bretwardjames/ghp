# @bretwardjames/ghp-core

## 0.9.0

### Minor Changes

- Add field discovery, hotfix branching, and named flags

  - `ghp fields` command to discover project fields and valid values
  - `--hotfix [ref]` flag on `ghp start` to branch from tags/commits
  - `--priority` and `--size` named flags on `ghp add`
  - `--body-file` and `--body-stdin` flags for issue body input
  - Verbose creation summary showing field assignments
  - Fix silent flag dropping after positional title arg
  - `get_fields` and `get_tags` MCP tools
  - `validateRefString()` for shell injection prevention in git refs

## 0.8.0

### Minor Changes

- Standup defaults to current user's activity. Added --user flag and --timeline mode.

## 0.7.1

### Patch Changes

- Fix standup command to capture PR reviews, authored PRs, and merges. Adds search passes for reviewed-by and author queries, plus new event types: review_submitted, review_requested, pr_created, pr_merged.

## 0.7.0

### Minor Changes

- 7789fab: Add `ghp standup` command for daily activity summary across CLI, MCP, and VS Code. Shows recent issue activity including comments, assignments, label changes, closures, and PR cross-references. Also fixes `ghp start --force-defaults` not auto-assigning the current user.

## 0.6.1

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

## 0.6.0

### Minor Changes

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

### Patch Changes

- fbe1b3c: Remove duplicate "Types" section header in core/index.ts

## 0.5.0

### Minor Changes

- 62b7941: Add `pre-pr` and `pr-creating` hook events for PR creation flow

  - `pre-pr`: Fires before PR creation begins, useful for validation, linting, and convention checks. Payload includes `changed_files` and `diff_stat`.
  - `pr-creating`: Fires just before GitHub API call, useful for suggesting PR title/body. Payload includes proposed `title` and `body`.

  Both events include `repo`, `branch`, and `base` fields.

- 16c3603: Add `ghp merge` command with pr-merged hook support

  New command to merge PRs and fire the `pr-merged` event hook, enabling external tools to respond to PR merges (e.g., Ragtime graduating branch memories).

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

- 3fce458: Add event file pattern for complex hook data

  Hooks can now access the full event payload via `${_event_file}`, which points to a temporary JSON file containing the complete event data. This is useful for hooks that need to process complex data structures (arrays, nested objects) that are difficult to pass via shell escaping.

  - Event file is written to `/tmp/ghp-event-{random}.json` before hook execution
  - File permissions set to 0600 (owner read/write only) for security
  - File is automatically cleaned up after hook execution completes
  - Works alongside all existing template variables

  Example usage:

  ```bash
  ragtime check --event-file ${_event_file}
  ```

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

## 0.4.0

### Minor Changes

- Add worktree lifecycle events to hook system

  - New `worktree-created` event fires when a NEW worktree is created (not for existing ones)
  - Payload includes repo, issue, branch, and worktree path/name
  - Enables tools like ragtime to set up context for parallel worktrees

## 0.3.0

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

## 0.2.0

### Minor Changes

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

- 150b7ef: feat(cli): add stop command, auto-apply epic label, fix progress display
  feat(vscode): show issue number before title in sidebar
  fix(progress): count CLOSED sub-issues as completed
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

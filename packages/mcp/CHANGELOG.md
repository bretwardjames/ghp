# @bretwardjames/ghp-mcp

## 0.5.0

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

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.9.0

## 0.4.0

### Minor Changes

- Standup defaults to current user's activity. Added --user flag and --timeline mode.

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.8.0

## 0.3.1

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.7.1

## 0.3.0

### Minor Changes

- 7789fab: Add `ghp standup` command for daily activity summary across CLI, MCP, and VS Code. Shows recent issue activity including comments, assignments, label changes, closures, and PR cross-references. Also fixes `ghp start --force-defaults` not auto-assigning the current user.

### Patch Changes

- Updated dependencies [7789fab]
  - @bretwardjames/ghp-core@0.7.0

## 0.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.6.1

## 0.1.5

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

## 0.1.4

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

- Updated dependencies [62b7941]
- Updated dependencies [16c3603]
- Updated dependencies [f0e69f8]
- Updated dependencies [3fce458]
- Updated dependencies [c5b3627]
- Updated dependencies [25143fe]
  - @bretwardjames/ghp-core@0.5.0

## 0.1.3

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.4.0

## 0.1.2

### Patch Changes

- Updated dependencies [b559617]
  - @bretwardjames/ghp-core@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.2.1

## 0.1.0

### Patch Changes

- 04cfa9e: feat(cli): add ghp update command for self-updating packages
- Updated dependencies [150b7ef]
- Updated dependencies [2e0ec74]
- Updated dependencies [9db9db9]
- Updated dependencies [ebff9dc]
  - @bretwardjames/ghp-core@0.2.0

## 0.1.0-beta.9

### Patch Changes

- feat(cli): add ghp update command for self-updating packages

## 0.1.0-beta.8

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.2.0-beta.9

## 0.1.0-beta.7

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.2.0-beta.8

## 0.1.0-beta.6

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.2.0-beta.7

## 0.1.0-beta.5

### Patch Changes

- Updated dependencies [9db9db9]
  - @bretwardjames/ghp-core@0.2.0-beta.6

## 0.1.0-beta.4

### Minor Changes

- Updated to support parent/child relationships and label management from core

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.2.0-beta.5

## 0.1.0-beta.3

### Minor Changes

- adding parallel worktree features

### Patch Changes

- 4544ce7: working our way toward version 2.1
- Updated dependencies
- Updated dependencies [4544ce7]
  - @bretwardjames/ghp-core@0.2.0-beta.4

## 0.1.0-beta.2

### Minor Changes

- adding worktree functions

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.2.0-beta.3

## 0.1.0-beta.1

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.2.0-beta.1

## 0.1.0-beta.0

### Minor Changes

- Adds non-interactive support for CLI commands, as well as a full MCP server for configuring AI agents to work directly with the CLI.

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.2.0-beta.0

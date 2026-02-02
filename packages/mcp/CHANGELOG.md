# @bretwardjames/ghp-mcp

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

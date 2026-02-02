---
"@bretwardjames/ghp-core": minor
"@bretwardjames/ghp-cli": patch
"@bretwardjames/ghp-mcp": patch
"gh-projects": patch
---

Centralize hook firing in core workflows

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

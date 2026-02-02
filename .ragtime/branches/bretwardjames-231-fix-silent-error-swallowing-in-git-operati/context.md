---
type: context
branch: bretwardjames/231-fix-silent-error-swallowing-in-git-operati
issue: 231
status: ready-for-review
created: '2026-02-02'
author: bretwardjames
---

## Issue

**#231**: Fix silent error swallowing in git operations

## Description

The codebase had 15+ git utility functions that swallowed errors by catching them and returning "safe" default values (null, false, [], 0) without any logging or error context. This made debugging impossible when git commands failed.

## Completed Work

### 1. Created GitError class
- Added `GitError` class to `packages/core/src/types.ts`
- Captures: command, stderr, exitCode, cwd
- Includes `toDetailedString()` method for logging

### 2. Updated execGit function
- Modified `packages/core/src/git-utils.ts` to throw GitError with full context

### 3. Fixed error swallowing in all git-utils functions
Functions updated to propagate errors:
- `detectRepository`, `getCurrentBranch`, `hasUncommittedChanges`
- `getCommitsBehind`, `getCommitsAhead`, `getRepositoryRoot`
- `getLocalBranches`, `getRemoteBranches`, `listWorktrees`

Functions with special handling (return false for specific exit codes):
- `branchExists` - exit code 1 means "doesn't exist"
- `isGitRepository` - exit code 128 means "not a git repo"
- `getDefaultBranch` - falls back to checking local branches
- `createWorktree` - exit code 128 for remote branch fallback

### 4. Exported GitError from core package
- Added to `packages/core/src/index.ts` exports
- Re-exported from CLI `git-utils.ts`
- Re-exported from VSCode extension `git-utils.ts`

### 5. Updated CLI consumers
- `packages/cli/src/commands/start.ts` - shows stderr on checkout failure
- `packages/cli/src/commands/stop.ts` - shows specific error for worktree removal
- `packages/cli/src/worktree-utils.ts` - includes stderr in error messages
- `packages/core/src/workflows/worktree.ts` - includes stderr in workflow results

### 6. Added tests
- Created `packages/core/src/git-error.test.ts` with 7 tests
- Updated `packages/core/src/workflows/worktree.test.ts` with 2 new tests

## Acceptance Criteria

- [x] Git operations throw GitError with command, stderr, exitCode
- [x] Callers can catch and inspect GitError for specific handling
- [x] CLI commands show meaningful error messages
- [x] Tests verify GitError behavior
- [x] All packages build successfully
- [x] All existing tests pass

## Key Design Decisions

1. **Propagate all errors by default** - Callers decide how to handle
2. **Special exit codes for expected outcomes** - `branchExists` returns false for exit code 1
3. **Include stderr in error messages** - Makes debugging easier
4. **GitError is a class, not just a type** - Enables `instanceof` checks

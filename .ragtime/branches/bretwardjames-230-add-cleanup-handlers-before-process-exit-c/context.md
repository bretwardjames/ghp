---
type: context
branch: bretwardjames/230-add-cleanup-handlers-before-process-exit-c
issue: 230
status: active
created: '2026-02-02'
author: bretwardjames
---

## Issue

**#230**: Add cleanup handlers before process.exit() calls



## Description

The CLI has ~170+ `process.exit()` calls that terminate immediately without allowing cleanup handlers to run. This can leave spawned processes orphaned, intervals running, or watchers active.

<!-- ghp-branch: bretwardjames/230-add-cleanup-handlers-before-process-exit-c -->

## Plan

1. **Create exit utility module** (`packages/cli/src/exit.ts`)
   - `registerCleanupHandler(fn)` - Add a cleanup function to run before exit
   - `exit(code)` - Run all handlers then call `process.exit(code)`
   - Handle both sync and async cleanup handlers
   - Support timeout to prevent hanging on stuck handlers

2. **Replace `process.exit()` calls** with the new `exit()` utility
   - Start with high-impact files that have known cleanup needs (agents.ts, start.ts)
   - Update remaining command files

3. **Register cleanup in relevant places**
   - `agents watch` - clear intervals, stop watchers
   - Child process spawning - track and terminate children
   - Terminal utilities - close tmux sessions if needed

## Acceptance Criteria

- [x] All `process.exit()` calls in packages/cli use the new exit utility
- [x] Cleanup handlers can be registered from any command
- [x] Async cleanup handlers are awaited with timeout
- [x] Existing functionality is preserved (tests pass)

## Notes

- Most `process.exit(1)` calls are for early error bailout - these don't need cleanup but should still use the utility for consistency
- The `agents watch` command already has SIGINT handling that clears intervals - this pattern should be centralized
- Consider whether we need to handle SIGTERM/SIGINT globally in the exit module


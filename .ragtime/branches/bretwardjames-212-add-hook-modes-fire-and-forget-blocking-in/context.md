---
type: context
branch: bretwardjames/212-add-hook-modes-fire-and-forget-blocking-in
issue: 212
status: complete
created: '2026-02-01'
author: bretwardjames
---

## Issue

**#212**: Add hook modes (fire-and-forget, blocking, interactive)



## Description

Extend the hook schema with a `mode` field to control hook behavior:
- `fire-and-forget` - Silent, logged, cannot abort (default, current behavior)
- `blocking` - Output shown on failure, exit 1 aborts workflow
- `interactive` - Always show output, prompt user to continue/abort/view

## Plan

### 1. Schema Changes (`packages/core/src/plugins/types.ts`) ✅
- [x] Add `HookMode` type: `'fire-and-forget' | 'blocking' | 'interactive'`
- [x] Add `mode?: HookMode` to `EventHook` interface
- [x] Add `continuePrompt?: string` for interactive mode custom prompts
- [x] Add `exitCodes?: { success?: number[]; abort?: number[]; warn?: number[] }`
- [x] Update `HookResult` with exit code and user decision fields

### 2. Registry Validation (`packages/core/src/plugins/registry.ts`) ✅
- [x] Add `VALID_MODES` constant
- [x] Add `isValidMode()` validation function
- [x] Update `normalizeHook()` to default mode to `'fire-and-forget'`
- [x] Validate exitCodes structure in `isValidHook()`

### 3. Executor Logic (`packages/core/src/plugins/executor.ts`) ✅
- [x] Capture exit code from process execution (using spawn instead of exec)
- [x] Add `classifyExitCode()` function using exitCodes config
- [x] Implement mode-specific behavior:
  - `fire-and-forget`: Log silently, never abort
  - `blocking`: Show output on failure, abort on non-success exit
  - `interactive`: Show output, prompt y/N/v
- [x] Add `promptUser()` for interactive mode
- [x] Add `showInPager()` for "view full output" option

### 4. CLI Interface (`packages/cli/src/commands/event-hooks.ts`) ✅
- [x] Add `--mode` flag to `ghp hooks add`
- [x] Add `--continue-prompt` flag
- [x] Update `HooksAddOptions` interface
- [x] Update `printHookDetails()` to show mode
- [x] Update `printHookSummary()` to indicate mode (with color badges)

## Acceptance Criteria

- [x] Hooks can specify mode in config
- [x] `ghp hooks add` supports `--mode` flag
- [x] Blocking hooks abort workflow on non-zero exit
- [x] Interactive hooks prompt user with y/N/v
- [x] View option opens full output in $PAGER

## Notes

- Used `spawn` instead of `exec` to properly capture exit codes
- Added `shouldAbort()` helper to check if workflow should be aborted
- Interactive mode loops on 'v' to allow viewing then re-prompting

## Files Changed

### Core Package (`packages/core/src/plugins/`)
- `types.ts` - Added HookMode, HookExitCodes, HookOutcome types; extended EventHook and HookResult
- `registry.ts` - Added VALID_MODES, isValidMode(), getValidModes(); updated normalization and validation
- `executor.ts` - Replaced exec with spawn; added classifyExitCode(), promptUser(), showInPager(), formatOutputBox()
- `index.ts` - Exported new types and shouldAbort function

### CLI Package (`packages/cli/src/`)
- `commands/event-hooks.ts` - Added --mode and --continue-prompt handling; updated display functions
- `index.ts` - Added --mode and --continue-prompt options to commander

### Documentation
- `packages/cli/README.md` - Added Hook Modes section with examples


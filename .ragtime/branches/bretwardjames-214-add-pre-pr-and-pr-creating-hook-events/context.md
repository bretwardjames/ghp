---
type: context
branch: bretwardjames/214-add-pre-pr-and-pr-creating-hook-events
issue: 214
status: complete
created: '2026-02-01'
author: bretwardjames
---

## Issue

**#214**: Add pre-pr and pr-creating hook events

## Description

Added two new hook events for the PR creation flow:
- `pre-pr` - Fires before PR creation begins (for validation, linting, convention checks)
- `pr-creating` - Fires just before GitHub API call (for suggesting PR title/body)

## Changes Made

### `packages/core/src/plugins/types.ts`
- Added `'pre-pr'` and `'pr-creating'` to `EventType` union
- Added `PrePrPayload` interface with `branch`, `base`, `changed_files`, and `diff_stat`
- Added `PrCreatingPayload` interface with `branch`, `base`, `title`, and `body`
- Added both to `EventPayload` union

### `packages/core/src/plugins/registry.ts`
- Added `'pre-pr'` and `'pr-creating'` to `VALID_EVENTS` array

### `packages/core/src/plugins/index.ts` & `packages/core/src/index.ts`
- Exported the new `PrePrPayload` and `PrCreatingPayload` types

### `packages/core/README.md`
- Updated event hooks documentation to include new events

## Acceptance Criteria

- [x] `pre-pr` event type defined with payload interface
- [x] `pr-creating` event type defined with payload interface
- [x] Both events in VALID_EVENTS array
- [x] Can register hooks for both events via CLI

## Notes

The actual firing of these hooks from the PR creation workflow needs to be implemented separately in:
- `packages/core/src/workflows/pr.ts`
- `packages/cli/src/commands/pr.ts`

This issue only adds the type definitions and registry support.

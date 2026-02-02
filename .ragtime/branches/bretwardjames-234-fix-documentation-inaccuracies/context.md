---
type: context
branch: bretwardjames/234-fix-documentation-inaccuracies
issue: 234
status: active
created: '2026-02-02'
author: bretwardjames
---

## Issue

**#234**: Fix documentation inaccuracies

## Description

The documentation for event hooks in the CLI README and CLI help text was out of date with the actual implementation. Two events (`pre-pr` and `pr-creating`) were missing, and template variables for all events were incomplete.

## What Was Done

### 1. Updated CLI README (packages/cli/README.md)

- Added missing events `pre-pr` and `pr-creating` to the command help section
- Completely rewrote the Events and Template Variables table to include all available variables for each event
- Added documentation for `${_event_file}` variable (temp file with full event payload)
- Updated examples to use `pre-pr` instead of `pr-created` for validation hooks (more appropriate timing)
- Added new example showing `pr-creating` for AI-generated PR descriptions

### 2. Updated CLI Help Text (packages/cli/src/index.ts)

- Added `pre-pr` and `pr-creating` to the `--event` option help text at line 214

### 3. Verified Core README (packages/core/README.md)

- Already accurate - no changes needed

## Files Changed

- `packages/cli/README.md` - Event hooks documentation
- `packages/cli/src/index.ts` - CLI help text for `ghp hooks add --event`

## Acceptance Criteria

- [x] All 8 events documented (issue-created, issue-started, pre-pr, pr-creating, pr-created, pr-merged, worktree-created, worktree-removed)
- [x] All template variables documented for each event
- [x] CLI help text matches documentation
- [x] Build passes
- [x] Examples updated to use correct events for their use case

## Notes

The source of truth for events and payloads is `packages/core/src/plugins/types.ts`. Future documentation updates should reference this file.

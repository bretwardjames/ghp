---
type: context
branch: bretwardjames/213-add-event-file-pattern-for-complex-hook-da
issue: 213
status: completed
created: '2026-02-01'
author: bretwardjames
---

## Issue

**#213**: Add event file pattern for complex hook data

## Description

For events with complex data (arrays, nested objects), write to a temp file instead of shell escaping. Hooks receive the file path via `${_event_file}`.

## Implementation Summary

### Files Modified

1. **`packages/core/src/plugins/executor.ts`**
   - Added imports: `fs`, `crypto`, `os`, `path`
   - Added `writeEventFile(payload)` - creates `/tmp/ghp-event-{random}.json` with 0600 permissions
   - Added `cleanupEventFile(filePath)` - removes temp file silently
   - Updated `substituteTemplateVariables()` to accept `eventFilePath` option and substitute `${_event_file}`
   - Updated `executeEventHook()` to write event file before execution and clean up in `finally` block

2. **`packages/core/src/plugins/types.ts`**
   - Added `${_event_file}` to the documented template variables in `EventHook.command`

### Design Decisions

- **Always create event file**: Every hook gets `${_event_file}` available, even if not used. Simpler and consistent.
- **Underscore prefix**: `_event_file` distinguishes system-generated variables from user-facing data like `issue.number`
- **try/finally cleanup**: Ensures file is removed even on timeout or error
- **0600 permissions**: Security measure since payloads may contain sensitive data

## Acceptance Criteria

- [x] `${_event_file}` resolves to temp file path
- [x] Temp file contains full event payload as JSON
- [x] Temp file is cleaned up after hook execution
- [x] Works alongside existing template variables
- [x] File permissions set to 0600

## Testing

- Build passes: `pnpm build`
- All 24 tests pass: `pnpm test`
- Manual verification of file creation, content, and cleanup

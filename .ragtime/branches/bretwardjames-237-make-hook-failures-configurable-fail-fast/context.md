---
type: context
branch: bretwardjames/237-make-hook-failures-configurable-fail-fast
issue: 237
status: complete
created: '2026-02-02'
author: bretwardjames
---

## Issue

**#237**: Make hook failures configurable (fail-fast vs continue)

## Description

Currently, hook execution stops on the first failure (fail-fast behavior). This feature allows users to configure whether hooks should continue running after failures and collect all errors.

## Plan

- [x] Add `OnFailureBehavior` type to core plugins types
- [x] Add `EventHookSettings` interface for per-event settings
- [x] Update `EventHooksConfig` to include `eventDefaults` map
- [x] Implement `getEventSettings()` in registry
- [x] Update executor to support `onFailure` option with precedence chain
- [x] Add `HooksConfig` to CLI config with `getHooksConfig()` helper
- [x] Update all workflows to accept and pass `onFailure` option
- [x] Update all CLI commands to pass `onFailure` from config
- [x] Add `loadHooksConfig()` to MCP package
- [x] Update MCP tools to use hooks config
- [x] Write tests for executor onFailure behavior
- [x] Fix existing workflow tests for new executeHooksForEvent signature

## Implementation Summary

### Configuration Precedence

1. **Per-event settings** (in `~/.config/ghp-cli/event-hooks.json`):
   ```json
   {
     "hooks": [...],
     "eventDefaults": {
       "pre-pr": { "onFailure": "fail-fast" },
       "issue-created": { "onFailure": "continue" }
     }
   }
   ```

2. **Global default** (in `~/.config/ghp-cli/config.json`):
   ```json
   {
     "hooks": {
       "onFailure": "continue"
     }
   }
   ```

3. **Hard default**: `fail-fast` (preserves existing behavior)

### Key Changes

- **packages/core/src/plugins/types.ts**: Added `OnFailureBehavior`, `EventHookSettings`, updated `EventHooksConfig`
- **packages/core/src/plugins/registry.ts**: Added `getEventSettings()`, `getValidOnFailureBehaviors()`
- **packages/core/src/plugins/executor.ts**: Added `onFailure` to `HookExecutionOptions`, implemented continue behavior
- **packages/cli/src/config.ts**: Added `HooksConfig` interface and `getHooksConfig()` helper
- **packages/mcp/src/tool-registry.ts**: Added `loadHooksConfig()` for MCP context
- **packages/core/src/workflows/*.ts**: All workflows now accept and pass `onFailure` option
- **packages/cli/src/commands/*.ts**: All commands now use `getHooksConfig()` to pass `onFailure`

### Test Coverage

Added 7 new tests in `packages/core/src/plugins/executor.test.ts`:
- fail-fast behavior (default)
- fail-fast behavior (explicit option)
- continue behavior (runs all hooks)
- continue behavior (collects all failures)
- per-event override (continue over fail-fast)
- per-event override (fail-fast over continue)
- fire-and-forget hooks (never abort)

## Acceptance Criteria

- [x] Users can set global default in CLI config
- [x] Users can override per-event in event-hooks config
- [x] fail-fast stops on first failure (existing behavior)
- [x] continue runs all hooks and collects failures
- [x] All existing tests pass
- [x] New tests cover onFailure behavior

## Notes

- Fire-and-forget hooks never set `aborted=true` regardless of exit code, so they're unaffected by the onFailure setting
- The MCP package has its own config loading since it can't import from CLI package
- Precedence chain ensures maximum flexibility: per-event > global > default

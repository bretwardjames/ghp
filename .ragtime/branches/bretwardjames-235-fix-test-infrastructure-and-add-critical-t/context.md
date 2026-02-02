---
type: context
branch: bretwardjames/235-fix-test-infrastructure-and-add-critical-t
issue: 235
status: active
created: '2026-02-02'
author: bretwardjames
---

## Issue

**#235**: Fix test infrastructure and add critical tests



## Description



<!-- ghp-branch: bretwardjames/235-fix-test-infrastructure-and-add-critical-t -->

## Plan

- [x] Set up test infrastructure for CLI package (vitest.config.ts, package.json)
- [x] Set up test infrastructure for MCP package (vitest.config.ts, package.json)
- [x] Expand core coverage config to include all src directories
- [x] Add critical tests for CLI start command (12 tests)
- [x] Add critical tests for CLI add-issue command (13 tests)
- [x] Add critical tests for MCP tool registry (9 tests)

## Acceptance Criteria

- [x] `pnpm test` passes across all packages
- [x] CLI package has vitest configured and tests running
- [x] MCP package has vitest configured and tests running
- [x] Core package coverage config includes all source files

## Summary

Added test infrastructure to CLI and MCP packages that previously had no tests:

**Files Created:**
- `packages/cli/vitest.config.ts`
- `packages/cli/src/commands/start.test.ts` (12 tests)
- `packages/cli/src/commands/add-issue.test.ts` (13 tests)
- `packages/mcp/vitest.config.ts`
- `packages/mcp/src/tool-registry.test.ts` (9 tests)

**Files Modified:**
- `packages/cli/package.json` - added vitest dependency and test scripts
- `packages/mcp/package.json` - added vitest dependency and test scripts
- `packages/core/vitest.config.ts` - expanded coverage to all src files

**Test Summary:**
- Core: 27 tests (existing)
- CLI: 25 tests (new)
- MCP: 9 tests (new)
- **Total: 61 tests**


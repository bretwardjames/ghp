---
type: context
branch: bretwardjames/232-fix-type-safety-issues-in-cli-command-hand
issue: 232
status: active
created: '2026-02-02'
author: bretwardjames
---

## Issue

**#232**: Fix type safety issues in CLI command handlers

## Description

Remove `any` types from CLI command handlers to improve type safety and catch potential bugs at compile time.

## Plan

- [x] Add `SortableFieldValue` type alias in `work.ts`
- [x] Update `getFieldValue` function return type in `work.ts`
- [x] Fix sorting comparison logic with proper type guards in `work.ts`
- [x] Add `SortableFieldValue` type alias in `plan.ts`
- [x] Update `getFieldValue` function return type in `plan.ts`
- [x] Fix sorting comparison logic with proper type guards in `plan.ts`
- [x] Fix `command` parameter type in `planCommand` (was `any`, now `Command | PlanOptions`)
- [x] Verify TypeScript compiles without errors
- [x] Verify all tests pass

## Acceptance Criteria

- [x] No `any` types in command handlers (excluding test files)
- [x] TypeScript strict mode passes
- [x] All existing tests pass
- [x] Sorting functionality unchanged

## Notes

The root cause of the initial TypeScript errors (300+ errors) was that the core package wasn't built,
so TypeScript couldn't resolve `@bretwardjames/ghp-core`. After building core, the actual type safety
issues were the `any` types in the sorting/field-value logic.

### Changes Made

1. **`work.ts`**:
   - Added `SortableFieldValue` type (`string | number | null`)
   - Updated `getFieldValue` return type
   - Fixed comparison logic with proper type narrowing

2. **`plan.ts`**:
   - Same changes as `work.ts`
   - Fixed `planCommand` signature to use `Command | PlanOptions` instead of `any`
   - Added proper runtime type narrowing for the command parameter

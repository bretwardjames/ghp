---
type: context
branch: bretwardjames/236-fix-cli-flag-collisions-and-validation
issue: 236
status: complete
created: '2026-02-02'
author: bretwardjames
---

## Issue

**#236**: Fix CLI flag collisions and validation

## Summary

Fixed short flag collisions where the same letter had different meanings across commands, and added comprehensive validation for enum-like flags and mutually exclusive options.

## Changes Made

### Files Modified

1. **packages/cli/src/index.ts** - Removed/changed colliding short flags
2. **packages/cli/src/validation.ts** - NEW: Validation utilities module
3. **packages/cli/src/validation.test.ts** - NEW: 32 tests for validation
4. **packages/cli/src/commands/start.ts** - Added validation for --assign, --branch-action, terminal modes
5. **packages/cli/src/commands/merge.ts** - Added validation for --squash/--rebase mutual exclusion
6. **packages/cli/src/commands/work.ts** - Added validation for --group
7. **packages/cli/src/commands/plan.ts** - Added validation for --group
8. **packages/cli/src/commands/switch.ts** - Added validation for terminal mode mutual exclusion
9. **packages/cli/src/commands/dashboard.ts** - Added validation for --max-diff-lines bounds
10. **.changeset/fix-cli-flag-collisions.md** - NEW: Changeset with migration guide

### Short Flags Removed (Breaking)

| Flag | Long Form | Command | Conflict |
|------|-----------|---------|----------|
| `-f` | `--flat` | work | vs `--force` (4 commands) |
| `-a` | `--assign` | add | vs `--all` (4 commands) |
| `-c` | `--create` | pr | vs `--config`/`--context`/`--command` |
| `-m` | `--mine` | plan | vs `--message`/`--mode` |
| `-t` | `--type` | progress | vs `--template`/`--timeout` |
| `-s` | `--show` | config | vs `--status` (3 commands) |
| `-p` | `--parent` | set-parent | vs `--project` (all) |
| `-b` | `--browser` | open | vs `--body` |

### Short Flags Changed

| Old | New | Long Form | Command |
|-----|-----|-----------|---------|
| `-l` | `-L` | `--labels` | add issue/epic |

### Validation Added

- **Enum validation**: --branch-action, --assign, --group, --mode
- **Mutual exclusivity**: --squash/--rebase, --nvim/--claude/--terminal-only
- **Numeric bounds**: --max-diff-lines (1-100000)

## Test Results

- All 32 new validation tests pass
- All 112 CLI tests pass
- Build succeeds

## What's Left

- [ ] Consider adding a flag registry pattern to prevent future collisions (out of scope)

## Notes

Design principle: Short flags within the same semantic family should have consistent meanings. `-f` meaning `--force` in 4 commands and `--flat` in 1 is confusing. Better to have fewer short flags with clear, consistent semantics.

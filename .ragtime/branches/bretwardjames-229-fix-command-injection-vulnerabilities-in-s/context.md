---
type: context
branch: bretwardjames/229-fix-command-injection-vulnerabilities-in-s
issue: 229
status: active
created: '2026-02-02'
author: bretwardjames
---

## Issue

**#229**: Fix command injection vulnerabilities in shell commands



## Description

Fix command injection vulnerabilities where user-controlled input is interpolated into shell commands without proper escaping. Found 3 vulnerable locations.

<!-- ghp-branch: bretwardjames/229-fix-command-injection-vulnerabilities-in-s -->

## Vulnerabilities Found

| File | Line | Severity | Issue |
|------|------|----------|-------|
| `packages/cli/src/commands/open.ts` | 48 | HIGH | URL in `exec()` with double quotes |
| `packages/mcp/src/tools/worktree.ts` | 106-108 | HIGH | `worktreePath` interpolated unsafely |
| `packages/cli/src/commands/update.ts` | 31, 43, 75 | MEDIUM | Package names in `execSync()` |

## Plan

- [x] Analyze codebase for command injection vulnerabilities
- [x] Create shared `shellEscape` utility in `@bretwardjames/ghp-core`
- [x] Fix `open.ts`: Use `spawn()` with array arguments
- [x] Fix `worktree.ts`: Apply shell escaping + validate issue is numeric
- [x] Fix `update.ts`: Use `spawnSync()` with array arguments
- [x] Add tests for the shell escape utility (21 tests)

## Acceptance Criteria

- All shell commands use either `spawn()` with array args or proper `shellEscape()`
- No user input directly interpolated into shell command strings
- Existing tests pass
- New tests cover shell escaping edge cases

## Notes

- Codebase already has `shellEscape()` in 3 places - consolidate to shared utility
- Pattern: `'str'` with internal quotes escaped as `'\''` (POSIX standard)


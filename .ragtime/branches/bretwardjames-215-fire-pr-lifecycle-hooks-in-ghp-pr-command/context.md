# Issue #215: Fire PR lifecycle hooks in ghp pr command

## Summary
Integrated full PR lifecycle hook firing (`pre-pr` → `pr-creating` → `pr-created`) into the core workflow layer, with proper abort handling and new CLI flags.

## What Was Done

### Core Workflow Changes (`packages/core/src/workflows/pr.ts`)
- Fire `pre-pr` hooks before PR creation with payload containing:
  - `changed_files`: List of modified file paths
  - `diff_stat`: { additions, deletions, files_changed }
  - `branch`, `base`, `repo`
- Fire `pr-creating` hooks just before GitHub API call with payload:
  - `title`, `body` (proposed values)
  - `branch`, `base`, `repo`
- Fire `pr-created` hooks after successful creation (fire-and-forget)
- Handle abort signals from blocking/interactive hooks
- Respect `skipHooks` and `force` options

### Type Updates (`packages/core/src/workflows/types.ts`)
- Added to `CreatePROptions`:
  - `skipHooks?: boolean` - Skip all hooks
  - `force?: boolean` - Ignore blocking hook failures
  - `issueTitle?: string` - For hook payloads
- Added to `CreatePRResult`:
  - `abortedByHook?: string` - Hook name that caused abort
  - `abortedAtEvent?: 'pre-pr' | 'pr-creating'` - Which event aborted

### CLI Updates (`packages/cli/src/commands/pr.ts`, `packages/cli/src/index.ts`)
- Added `-f, --force` flag to bypass blocking hook failures
- Added `--no-hooks` flag to skip all hooks
- Refactored to use `createPRWorkflow` instead of direct implementation
- Removed duplicate hook firing code (now centralized in workflow)

### Tests (`packages/core/src/workflows/pr.test.ts`)
- Updated existing tests for new hook firing sequence
- Added tests for abort behavior
- Added tests for `force` and `skipHooks` options

## Hook Flow

```
ghp pr --create
    │
    ├── Fire pre-pr hooks (blocking/interactive)
    │   └── Abort if hook fails (unless --force)
    │
    ├── Fire pr-creating hooks (blocking/interactive)
    │   └── Abort if hook fails (unless --force)
    │
    ├── Create PR via GitHub API
    │
    └── Fire pr-created hooks (fire-and-forget)
```

## Acceptance Criteria Status
- [x] pre-pr hooks fire before PR creation
- [x] Blocking pre-pr hook failure aborts PR creation
- [x] --force flag bypasses blocking failures
- [x] --no-hooks flag skips all hooks
- [x] pr-creating hooks fire with title/body
- [x] pr-created hooks fire after successful creation
- [x] pr-created payload includes PR number, URL

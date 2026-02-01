# Issue #209: Add worktree lifecycle events to hook system

## Summary

Add `worktree-created` and `worktree-removed` events to the ghp hook system so external tools (like tailscale-magic) can respond to worktree lifecycle changes.

## Implementation Plan

| # | Task | Files |
|---|------|-------|
| 1 | Add `worktree-created` and `worktree-removed` to EventType union | `packages/core/src/plugins/types.ts` |
| 2 | Define WorktreeCreatedPayload and WorktreeRemovedPayload interfaces | `packages/core/src/plugins/types.ts` |
| 3 | Add new events to VALID_EVENTS array | `packages/core/src/plugins/registry.ts` |
| 4 | Add template variable substitution for worktree fields | `packages/core/src/plugins/executor.ts` |
| 5 | Fire `worktree-created` in start.ts after parallel worktree creation | `packages/cli/src/commands/start.ts` |
| 6 | Fire `worktree-removed` in worktree.ts before/after removal | `packages/cli/src/commands/worktree.ts` |

## Payload Interfaces

```typescript
interface WorktreeCreatedPayload extends BaseEventPayload {
  issue?: { number: number; title: string; url: string };
  branch: string;
  worktree: {
    path: string;   // Absolute path to worktree
    name: string;   // Directory name
  };
}

interface WorktreeRemovedPayload extends BaseEventPayload {
  issue?: { number: number; title: string; url: string };
  branch: string;
  worktree: {
    path: string;
    name: string;
  };
}
```

## Template Variables

- `${worktree.path}` - Full path like `/home/user/project-worktrees/123-feature`
- `${worktree.name}` - Directory name like `123-feature`
- `${branch}` - Branch name
- `${issue.number}` - Issue number if linked
- `${issue.title}` - Issue title if linked
- `${repo}` - Repository as owner/name

## Example Usage

```bash
# Set up Tailscale funnel when worktree created
ghp hooks add ts-magic-up \
  --event worktree-created \
  --command "ts-magic up ${worktree.path}"

# Tear down funnel when worktree removed
ghp hooks add ts-magic-down \
  --event worktree-removed \
  --command "ts-magic down --port ${issue.number}"
```

## Key Locations

- **EventType definition**: `packages/core/src/plugins/types.ts:15-19`
- **VALID_EVENTS array**: `packages/core/src/plugins/registry.ts:42`
- **Template substitution**: `packages/core/src/plugins/executor.ts:41-71`
- **Worktree creation**: `packages/cli/src/commands/start.ts:437-670`
- **Worktree removal**: `packages/cli/src/commands/worktree.ts:26-93`

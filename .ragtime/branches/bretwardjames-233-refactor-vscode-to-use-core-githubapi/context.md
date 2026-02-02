---
type: context
branch: bretwardjames/233-refactor-vscode-to-use-core-githubapi
issue: 233
status: active
created: '2026-02-02'
author: bretwardjames
---

## Issue

**#233**: Refactor VSCode to use core GitHubAPI

## Description

The VSCode extension has its own 2,092-line `github-api.ts` that duplicates functionality from the core package's 1,444-line implementation. This refactoring eliminates the duplication by making VSCode use core's `GitHubAPI` class with a VSCode-specific `TokenProvider`.

## Plan

### Phase 1: Extend Core API (if needed)
- [ ] Audit core for any VSCode-required methods not present
- [ ] Add `getMyProjects()` to core if needed (user's personal projects)
- [ ] Add `findPRForIssue()` to core if needed

### Phase 2: Create VSCode TokenProvider & Wrapper
- [ ] Create `apps/vscode/src/vscode-github-api.ts`
- [ ] Implement `TokenProvider` using `vscode.authentication.getSession()`
- [ ] Create `VSCodeGitHubAPI` class extending core's `GitHubAPI`
- [ ] Add VSCode-specific error handling (show error messages in VS Code UI)

### Phase 3: Migrate Extension Entry Point
- [ ] Update `extension.ts` to use new `VSCodeGitHubAPI`
- [ ] Test basic authentication flow

### Phase 4: Migrate High-Use Files
- [ ] `tree-provider.ts` - Tree view data loading
- [ ] `planning-board.ts` - Planning board views

### Phase 5: Migrate Remaining Files
- [ ] `pr-workflow.ts` - PR handling
- [ ] `start-working.ts` - Issue workflow
- [ ] `worktree.ts` - Worktree management
- [ ] `issue-detail-panel.ts` - Issue details
- [ ] `branch-linker.ts` - Branch linking

### Phase 6: Cleanup
- [ ] Update VSCode types to use core exports where possible
- [ ] Delete `apps/vscode/src/github-api.ts`
- [ ] Remove `@octokit/graphql` from VSCode package.json if no longer needed

## Acceptance Criteria

- [ ] VSCode extension uses core's `GitHubAPI` class
- [ ] `apps/vscode/src/github-api.ts` is deleted
- [ ] All existing VSCode functionality still works
- [ ] TypeScript compiles without errors
- [ ] Extension package builds successfully

## Notes

**Key Architecture Decision:** Use composition/extension pattern:
```typescript
class VSCodeGitHubAPI extends CoreGitHubAPI {
    // VSCode-specific methods only
}
```

**Files to migrate (8 total):**
- extension.ts, tree-provider.ts, planning-board.ts
- pr-workflow.ts, start-working.ts, worktree.ts
- issue-detail-panel.ts, branch-linker.ts

**Gap Analysis Summary:**
- Core has 30 methods, VSCode has 48
- ~18 VSCode methods are duplicates of core
- Some VSCode-specific helpers may need to be kept or moved to core

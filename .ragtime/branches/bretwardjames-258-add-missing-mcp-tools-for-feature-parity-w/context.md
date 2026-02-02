---
type: context
branch: bretwardjames/258-add-missing-mcp-tools-for-feature-parity-w
issue: 258
status: active
created: '2026-02-02'
author: bretwardjames
---

## Issue

**#258**: Add missing MCP tools for feature parity with CLI

## Current State

The MCP server has 11 tools, the CLI has 32 commands. This creates a gap where AI assistants cannot perform common operations via MCP.

### Existing MCP Tools (12 total)
1. `get_work` - List my assigned items
2. `get_plan` - View project board
3. `move_issue` - Change issue status
4. `mark_done` - Mark issue as done
5. `start_work` - Mark issue as in progress
6. `add_issue` - Create new issue
7. `update_issue` - Update issue title/body
8. `assign_issue` - Update assignees
9. `add_comment` - Add comment to issue
10. `set_field` - Set custom field value
11. `create_worktree` - Create parallel worktree

## Implementation Plan

### Phase 1: High Priority Tools (Core Workflow)

#### 1.1 `create_pr` Tool
- **File**: `packages/mcp/src/tools/create-pr.ts`
- **Core function**: Use `createPRWorkflow` from `@bretwardjames/ghp-core`
- **Parameters**:
  - `title` (required): PR title
  - `body` (optional): PR description
  - `baseBranch` (optional, default: main): Target branch
  - `issueNumber` (optional): Link to issue
  - `skipHooks` (optional): Skip pre-pr/pr-creating hooks
  - `force` (optional): Force creation even if hooks fail

#### 1.2 `merge_pr` Tool
- **File**: `packages/mcp/src/tools/merge-pr.ts`
- **Implementation**: Use `gh pr merge` via spawnSync
- **Parameters**:
  - `number` (required): PR number to merge
  - `method` (optional): merge/squash/rebase (default: squash)
  - `deleteHead` (optional): Delete head branch after merge

#### 1.3 `list_worktrees` Tool
- **File**: `packages/mcp/src/tools/list-worktrees.ts`
- **Core function**: Use `listWorktrees` from `@bretwardjames/ghp-core`
- **Parameters**: None
- **Returns**: Array of worktree info (path, branch, issue)

#### 1.4 `remove_worktree` Tool
- **File**: `packages/mcp/src/tools/remove-worktree.ts`
- **Core function**: Use `removeWorktreeWorkflow` from `@bretwardjames/ghp-core`
- **Parameters**:
  - `issue` (optional): Issue number to find worktree for
  - `path` (optional): Direct worktree path
  - `force` (optional): Force removal with uncommitted changes

#### 1.5 `stop_work` Tool
- **File**: `packages/mcp/src/tools/stop-work.ts`
- **Implementation**: Remove `@username:active` label from issue
- **Parameters**:
  - `issue` (required): Issue number
- **Core function**: Use `removeLabelFromIssue` from GitHubAPI

### Phase 2: Medium Priority Tools (Issue Management)

#### 2.1 `set_parent` Tool
- **File**: `packages/mcp/src/tools/set-parent.ts`
- **Core function**: Use `addSubIssue` from GitHubAPI
- **Parameters**:
  - `issue` (required): Child issue number
  - `parent` (required): Parent issue number
  - `remove` (optional): If true, remove parent relationship

#### 2.2 `add_label` / `remove_label` Tools
- **File**: `packages/mcp/src/tools/label.ts`
- **Core functions**: Use `addLabelToIssue` / `removeLabelFromIssue` from GitHubAPI
- **Parameters**:
  - `issue` (required): Issue number
  - `label` (required): Label name

#### 2.3 `get_progress` Tool
- **File**: `packages/mcp/src/tools/get-progress.ts`
- **Implementation**: Use `getIssueRelationships` to get sub-issues, then count states
- **Parameters**:
  - `issue` (required): Epic/parent issue number
- **Returns**: Progress summary (total, open, closed, percentage)

#### 2.4 `link_branch` / `unlink_branch` Tools
- **File**: `packages/mcp/src/tools/branch-link.ts`
- **Core functions**: Use `BranchLinker` from `@bretwardjames/ghp-core`
- **Parameters**:
  - `issue` (required): Issue number
  - `branch` (required for link): Branch name

### Phase 3: Lower Priority Tools (Convenience)

#### 3.1 `get_issue` Tool
- **File**: `packages/mcp/src/tools/get-issue.ts`
- **Core function**: Use `getIssueDetails` + `findItemByNumber` from GitHubAPI
- **Parameters**:
  - `issue` (required): Issue number
- **Returns**: Full issue details (title, body, status, labels, comments, relationships)

## Technical Notes

### Pattern to Follow (from existing tools)

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

export const meta: ToolMeta = {
    name: 'tool_name',
    category: 'action', // or 'read'
};

export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'tool_name',
        {
            title: 'Tool Title',
            description: 'What the tool does',
            inputSchema: {
                param: z.number().describe('Parameter description'),
            },
        },
        async ({ param }) => {
            const authenticated = await context.ensureAuthenticated();
            if (!authenticated) {
                return {
                    content: [{ type: 'text', text: 'Error: Not authenticated.' }],
                    isError: true,
                };
            }

            // ... implementation
        }
    );
}
```

### Registry Update Pattern

In `tool-registry.ts`:
1. Import the tool module
2. Add to TOOLS array

### Core Exports Available

From `@bretwardjames/ghp-core`:
- `createPRWorkflow` - PR creation with hooks
- `removeWorktreeWorkflow` - Remove worktree with hooks
- `listWorktrees` - List all worktrees
- `BranchLinker` - Link/unlink branches to issues
- `GitHubAPI.addLabelToIssue` / `removeLabelFromIssue`
- `GitHubAPI.addSubIssue` / `removeSubIssue`
- `GitHubAPI.getIssueDetails`
- `GitHubAPI.getIssueRelationships`

## Progress

- [x] Phase 1: High Priority Tools
  - [x] create_pr
  - [x] merge_pr
  - [x] list_worktrees
  - [x] remove_worktree
  - [x] stop_work
- [x] Phase 2: Medium Priority Tools
  - [x] set_parent
  - [x] add_label / remove_label
  - [x] get_progress
  - [x] link_branch / unlink_branch
- [x] Phase 3: Lower Priority Tools
  - [x] get_issue
- [x] Update tool-registry.ts
- [x] Build passes
- [x] Tests pass

## Notes

- Keep tools simple and focused on single operations
- Reuse core workflows wherever possible to maintain consistency
- Fire hooks appropriately (use loadHooksConfig for onFailure behavior)

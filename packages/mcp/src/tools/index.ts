import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../server.js';

import { register as registerWork } from './work.js';
import { register as registerPlan } from './plan.js';
import { register as registerMove } from './move.js';
import { register as registerDone } from './done.js';
import { register as registerStart } from './start.js';
import { register as registerAddIssue } from './add-issue.js';
import { register as registerUpdateIssue } from './update-issue.js';
import { register as registerAssign } from './assign.js';
import { register as registerComment } from './comment.js';
import { register as registerSetField } from './set-field.js';
import { register as registerWorktree } from './worktree.js';
// Phase 1: High Priority Tools
import { register as registerCreatePr } from './create-pr.js';
import { register as registerMergePr } from './merge-pr.js';
import { register as registerListWorktrees } from './list-worktrees.js';
import { register as registerRemoveWorktree } from './remove-worktree.js';
import { register as registerStopWork } from './stop-work.js';
// Phase 2: Medium Priority Tools
import { register as registerSetParent } from './set-parent.js';
import { register as registerAddLabel } from './add-label.js';
import { register as registerRemoveLabel } from './remove-label.js';
import { register as registerGetProgress } from './get-progress.js';
import { register as registerLinkBranch } from './link-branch.js';
import { register as registerUnlinkBranch } from './unlink-branch.js';
// Phase 3: Lower Priority Tools
import { register as registerGetIssue } from './get-issue.js';

/**
 * @deprecated Use registerEnabledTools from '../tool-registry.js' instead.
 * This function registers all tools without respecting configuration.
 */
export function registerAllTools(server: McpServer, context: ServerContext): void {
    // Read tools
    registerWork(server, context);
    registerPlan(server, context);
    registerListWorktrees(server, context);
    registerGetProgress(server, context);
    registerGetIssue(server, context);

    // Action tools
    registerMove(server, context);
    registerDone(server, context);
    registerStart(server, context);
    registerStopWork(server, context);
    registerAddIssue(server, context);
    registerUpdateIssue(server, context);
    registerAssign(server, context);
    registerComment(server, context);
    registerSetField(server, context);
    registerAddLabel(server, context);
    registerRemoveLabel(server, context);
    registerSetParent(server, context);
    registerLinkBranch(server, context);
    registerUnlinkBranch(server, context);

    // PR tools
    registerCreatePr(server, context);
    registerMergePr(server, context);

    // Worktree tools (parallel work)
    registerWorktree(server, context);
    registerRemoveWorktree(server, context);
}

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

/**
 * @deprecated Use registerEnabledTools from '../tool-registry.js' instead.
 * This function registers all tools without respecting configuration.
 */
export function registerAllTools(server: McpServer, context: ServerContext): void {
    // Read tools
    registerWork(server, context);
    registerPlan(server, context);

    // Action tools
    registerMove(server, context);
    registerDone(server, context);
    registerStart(server, context);
    registerAddIssue(server, context);
    registerUpdateIssue(server, context);
    registerAssign(server, context);
    registerComment(server, context);
    registerSetField(server, context);

    // Worktree tools (parallel work)
    registerWorktree(server, context);
}

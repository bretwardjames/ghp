import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../server.js';

import { registerWorkTool } from './work.js';
import { registerPlanTool } from './plan.js';
import { registerMoveTool } from './move.js';
import { registerDoneTool } from './done.js';
import { registerStartTool } from './start.js';
import { registerAddIssueTool } from './add-issue.js';
import { registerAssignTool } from './assign.js';
import { registerCommentTool } from './comment.js';
import { registerSetFieldTool } from './set-field.js';

/**
 * Registers all MCP tools with the server.
 */
export function registerAllTools(server: McpServer, context: ServerContext): void {
    // Read tools
    registerWorkTool(server, context);
    registerPlanTool(server, context);

    // Action tools
    registerMoveTool(server, context);
    registerDoneTool(server, context);
    registerStartTool(server, context);
    registerAddIssueTool(server, context);
    registerAssignTool(server, context);
    registerCommentTool(server, context);
    registerSetFieldTool(server, context);
}

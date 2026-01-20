import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../server.js';

import { registerWorkResource } from './work.js';
import { registerPlanResource } from './plan.js';
import { registerIssueResource } from './issue.js';
import { registerProjectsResource } from './projects.js';

/**
 * Registers all MCP resources with the server.
 */
export function registerAllResources(server: McpServer, context: ServerContext): void {
    registerWorkResource(server, context);
    registerPlanResource(server, context);
    registerIssueResource(server, context);
    registerProjectsResource(server, context);
}

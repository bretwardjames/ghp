import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';

/**
 * Registers the assign_issue tool.
 * Assigns or unassigns users to/from an issue.
 */
export function registerAssignTool(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'assign_issue',
        {
            title: 'Assign Issue',
            description:
                'Assign or unassign users to/from a GitHub issue. Use "me" to assign yourself.',
            inputSchema: {
                issue: z.number().describe('Issue number to assign'),
                users: z
                    .array(z.string())
                    .describe('Usernames to assign (use "me" for yourself)'),
                remove: z
                    .boolean()
                    .optional()
                    .describe('Remove these assignees instead of adding'),
            },
        },
        async ({ issue, users, remove = false }) => {
            const authenticated = await context.ensureAuthenticated();
            if (!authenticated) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Error: Not authenticated.',
                        },
                    ],
                    isError: true,
                };
            }

            const repo = await context.getRepo();
            if (!repo) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Error: Not in a git repository with a GitHub remote.',
                        },
                    ],
                    isError: true,
                };
            }

            try {
                // Replace "me" with actual username
                const resolvedUsers = users.map((u) =>
                    u.toLowerCase() === 'me' ? context.api.username || u : u
                );

                // Note: The current ghp-core API doesn't have direct assignee mutation
                // This would need to be added to the core API
                // For now, return a message indicating what would happen
                const action = remove ? 'unassign' : 'assign';
                const message = `Would ${action} ${resolvedUsers.join(', ')} ${remove ? 'from' : 'to'} issue #${issue}.\n\nNote: Direct assignee mutation is not yet implemented in the MCP server. Please use the CLI: ghp assign ${issue} ${resolvedUsers.join(' ')}${remove ? ' --remove' : ''}`;

                return {
                    content: [
                        {
                            type: 'text',
                            text: message,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error assigning issue: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

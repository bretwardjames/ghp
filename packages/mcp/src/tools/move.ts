import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';

/**
 * Registers the move_issue tool.
 * Changes the status of an issue in a GitHub Project.
 */
export function registerMoveTool(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'move_issue',
        {
            title: 'Move Issue',
            description:
                'Change the status of an issue in a GitHub Project board. Use this to move issues between columns (e.g., Todo → In Progress → Done).',
            inputSchema: {
                issue: z.number().describe('Issue number to move'),
                status: z.string().describe('Target status name (e.g., "In Progress", "Done")'),
            },
        },
        async ({ issue, status }) => {
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
                // Find the issue in projects
                const item = await context.api.findItemByNumber(repo, issue);
                if (!item) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Issue #${issue} not found in any project.`,
                            },
                        ],
                        isError: true,
                    };
                }

                // Get status field options
                const statusField = await context.api.getStatusField(item.projectId);
                if (!statusField) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'Could not find Status field in the project.',
                            },
                        ],
                        isError: true,
                    };
                }

                // Find the target status option
                const targetOption = statusField.options.find(
                    (opt) => opt.name.toLowerCase() === status.toLowerCase()
                );
                if (!targetOption) {
                    const available = statusField.options.map((o) => o.name).join(', ');
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Status "${status}" not found. Available statuses: ${available}`,
                            },
                        ],
                        isError: true,
                    };
                }

                // Update the status
                const success = await context.api.updateItemStatus(
                    item.projectId,
                    item.id,
                    statusField.fieldId,
                    targetOption.id
                );

                if (success) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Moved issue #${issue} to "${targetOption.name}".`,
                            },
                        ],
                    };
                } else {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'Failed to update issue status.',
                            },
                        ],
                        isError: true,
                    };
                }
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error moving issue: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

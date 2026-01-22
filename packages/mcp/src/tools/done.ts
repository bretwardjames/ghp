import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'mark_done',
    category: 'action',
};

/**
 * Registers the mark_done tool.
 * Marks an issue as done in the project board.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'mark_done',
        {
            title: 'Mark Done',
            description:
                'Mark an issue as done in the GitHub Project board. This sets the status to "Done".',
            inputSchema: {
                issue: z.number().describe('Issue number to mark as done'),
            },
        },
        async ({ issue }) => {
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

                // Find the "Done" status option
                const doneOption = statusField.options.find(
                    (opt) => opt.name.toLowerCase() === 'done'
                );
                if (!doneOption) {
                    const available = statusField.options.map((o) => o.name).join(', ');
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `No "Done" status found. Available statuses: ${available}`,
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
                    doneOption.id
                );

                if (success) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Marked issue #${issue} as done.`,
                            },
                        ],
                    };
                } else {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'Failed to mark issue as done.',
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
                            text: `Error marking issue done: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

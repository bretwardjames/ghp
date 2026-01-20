import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';

/**
 * Registers the set_field tool.
 * Sets a custom field value on a project item.
 */
export function registerSetFieldTool(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'set_field',
        {
            title: 'Set Field',
            description:
                'Set a custom field value on a GitHub Project item. Works with single-select, text, number, and date fields.',
            inputSchema: {
                issue: z.number().describe('Issue number'),
                field: z.string().describe('Field name (e.g., "Priority", "Size")'),
                value: z.string().describe('Value to set'),
            },
        },
        async ({ issue, field, value }) => {
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

                // Get project fields
                const fields = await context.api.getProjectFields(item.projectId);
                const targetField = fields.find(
                    (f) => f.name.toLowerCase() === field.toLowerCase()
                );

                if (!targetField) {
                    const available = fields.map((f) => f.name).join(', ');
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Field "${field}" not found. Available fields: ${available}`,
                            },
                        ],
                        isError: true,
                    };
                }

                // Set the field value
                const success = await context.api.setFieldValue(
                    item.projectId,
                    item.id,
                    targetField.id,
                    value
                );

                if (success) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Set "${field}" to "${value}" on issue #${issue}.`,
                            },
                        ],
                    };
                } else {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'Failed to set field value.',
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
                            text: `Error setting field: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

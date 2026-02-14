import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'set_field',
    category: 'action',
};

/**
 * Registers the set_field tool.
 * Sets a custom field value on a project item.
 */
export function register(server: McpServer, context: ServerContext): void {
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

                // Build the value object based on field type
                let fieldValue: { text?: string; number?: number; singleSelectOptionId?: string };

                if (targetField.type === 'SingleSelect' && targetField.options) {
                    const option = targetField.options.find(
                        (o) => o.name.toLowerCase() === value.toLowerCase()
                    );
                    if (!option) {
                        const available = targetField.options.map((o) => o.name).join(', ');
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `Invalid value "${value}" for field "${field}". Available options: ${available}`,
                                },
                            ],
                            isError: true,
                        };
                    }
                    fieldValue = { singleSelectOptionId: option.id };
                } else if (targetField.type === 'Number') {
                    const num = parseFloat(value);
                    if (isNaN(num)) {
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `Value must be a number for field "${field}".`,
                                },
                            ],
                            isError: true,
                        };
                    }
                    fieldValue = { number: num };
                } else {
                    fieldValue = { text: value };
                }

                // Set the field value
                const result = await context.api.setFieldValue(
                    item.projectId,
                    item.id,
                    targetField.id,
                    fieldValue
                );

                if (result.success) {
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
                                text: `Failed to set field "${field}": ${result.error || 'Unknown error'}`,
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

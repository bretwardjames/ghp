import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { validateNumericInput } from '@bretwardjames/ghp-core';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'set_parent',
    category: 'action',
    disabledByDefault: true,
};

/**
 * Registers the set_parent tool.
 * Sets or removes the parent issue for a sub-issue.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'set_parent',
        {
            title: 'Set Parent Issue',
            description:
                'Set or remove the parent issue for a sub-issue. Uses GitHub sub-issues feature.',
            inputSchema: {
                issue: z.number().describe('Child issue number'),
                parent: z
                    .number()
                    .optional()
                    .describe('Parent issue number (omit to remove parent)'),
            },
        },
        async ({ issue, parent }) => {
            const authenticated = await context.ensureAuthenticated();
            if (!authenticated) {
                return {
                    content: [
                        {
                            type: 'text' as const,
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
                            type: 'text' as const,
                            text: 'Error: Not in a git repository with a GitHub remote.',
                        },
                    ],
                    isError: true,
                };
            }

            try {
                // Validate issue numbers
                const safeIssue = validateNumericInput(issue, 'issue');
                const safeParent = parent ? validateNumericInput(parent, 'parent') : undefined;

                // Get current relationships to find existing parent
                const relationships = await context.api.getIssueRelationships(repo, safeIssue);
                if (!relationships) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `Issue #${issue} not found.`,
                            },
                        ],
                        isError: true,
                    };
                }

                // If removing parent
                if (!safeParent) {
                    if (!relationships.parent) {
                        return {
                            content: [
                                {
                                    type: 'text' as const,
                                    text: `Issue #${issue} has no parent issue.`,
                                },
                            ],
                        };
                    }

                    const success = await context.api.removeSubIssue(
                        repo,
                        relationships.parent.number,
                        safeIssue
                    );

                    if (!success) {
                        return {
                            content: [
                                {
                                    type: 'text' as const,
                                    text: `Failed to remove parent from issue #${issue}.`,
                                },
                            ],
                            isError: true,
                        };
                    }

                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `Removed parent #${relationships.parent.number} from issue #${issue}.`,
                            },
                        ],
                    };
                }

                // If there's an existing parent, remove it first
                if (relationships.parent && relationships.parent.number !== safeParent) {
                    await context.api.removeSubIssue(repo, relationships.parent.number, safeIssue);
                }

                // Add as sub-issue to new parent
                const success = await context.api.addSubIssue(repo, safeParent, safeIssue);

                if (!success) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `Failed to set parent #${parent} for issue #${issue}. Make sure both issues exist.`,
                            },
                        ],
                        isError: true,
                    };
                }

                // Get parent title for message
                const parentItem = await context.api.findItemByNumber(repo, safeParent);
                const parentTitle = parentItem?.title || '';

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Set issue #${issue} as sub-issue of #${parent}${parentTitle ? ` "${parentTitle}"` : ''}.`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Error setting parent: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

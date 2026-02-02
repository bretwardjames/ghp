import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { validateNumericInput, validateSafeString } from '@bretwardjames/ghp-core';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'remove_label',
    category: 'action',
    disabledByDefault: true,
};

/**
 * Registers the remove_label tool.
 * Removes a label from an issue.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'remove_label',
        {
            title: 'Remove Label',
            description: 'Remove a label from an issue.',
            inputSchema: {
                issue: z.number().describe('Issue number'),
                label: z.string().describe('Label name to remove'),
            },
        },
        async ({ issue, label }) => {
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
                const safeIssue = validateNumericInput(issue, 'issue');
                const safeLabel = validateSafeString(label, 'label');

                const success = await context.api.removeLabelFromIssue(repo, safeIssue, safeLabel);

                if (!success) {
                    const item = await context.api.findItemByNumber(repo, safeIssue);
                    if (!item) {
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

                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `Issue #${issue} does not have label "${label}".`,
                            },
                        ],
                    };
                }

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Removed label "${label}" from issue #${issue}.`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Error removing label: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

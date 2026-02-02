import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { validateNumericInput, validateSafeString } from '@bretwardjames/ghp-core';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'add_label',
    category: 'action',
    disabledByDefault: true,
};

/**
 * Registers the add_label tool.
 * Adds a label to an issue.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'add_label',
        {
            title: 'Add Label',
            description: 'Add a label to an issue. Creates the label if it does not exist.',
            inputSchema: {
                issue: z.number().describe('Issue number'),
                label: z.string().describe('Label name to add'),
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

                // Ensure label exists (creates if needed)
                await context.api.ensureLabel(repo, safeLabel);

                // Add label to issue
                const success = await context.api.addLabelToIssue(repo, safeIssue, safeLabel);

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
                                text: `Failed to add label "${label}" to issue #${issue}.`,
                            },
                        ],
                        isError: true,
                    };
                }

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Added label "${label}" to issue #${issue}.`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Error adding label: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

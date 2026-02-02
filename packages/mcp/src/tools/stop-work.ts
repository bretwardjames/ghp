import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { validateNumericInput } from '@bretwardjames/ghp-core';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'stop_work',
    category: 'action',
    disabledByDefault: true,
};

/**
 * Registers the stop_work tool.
 * Stops working on an issue by removing the active label.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'stop_work',
        {
            title: 'Stop Work',
            description:
                'Stop working on an issue by removing the @username:active label.',
            inputSchema: {
                issue: z.number().describe('Issue number to stop working on'),
            },
        },
        async ({ issue }) => {
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
                // Validate issue number
                const safeIssue = validateNumericInput(issue, 'issue');

                // Get the active label name for this user
                const activeLabelName = context.api.getActiveLabelName();

                // Remove the active label
                const success = await context.api.removeLabelFromIssue(
                    repo,
                    safeIssue,
                    activeLabelName
                );

                if (!success) {
                    // Check if the issue exists
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

                    // Issue exists but label removal failed - probably didn't have the label
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `Issue #${issue} "${item.title}" does not have the ${activeLabelName} label.`,
                            },
                        ],
                    };
                }

                // Get issue title for the message
                const item = await context.api.findItemByNumber(repo, safeIssue);
                const title = item?.title || '';

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Stopped working on issue #${issue}${title ? ` "${title}"` : ''} - removed ${activeLabelName} label.`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Error stopping work: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

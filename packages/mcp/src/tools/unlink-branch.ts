import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { BranchLinker, validateNumericInput } from '@bretwardjames/ghp-core';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'unlink_branch',
    category: 'action',
    disabledByDefault: true,
};

/**
 * Registers the unlink_branch tool.
 * Removes the branch link from an issue.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'unlink_branch',
        {
            title: 'Unlink Branch',
            description: 'Remove the branch link from an issue.',
            inputSchema: {
                issue: z.number().describe('Issue number'),
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
                const safeIssue = validateNumericInput(issue, 'issue');

                const linker = new BranchLinker(context.api);

                // Check if there's a linked branch first
                const linkedBranch = await linker.getLinkedBranch(repo, safeIssue);
                if (!linkedBranch) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `Issue #${issue} has no linked branch.`,
                            },
                        ],
                    };
                }

                const success = await linker.unlinkBranch(repo, safeIssue);

                if (!success) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `Failed to unlink branch from issue #${issue}.`,
                            },
                        ],
                        isError: true,
                    };
                }

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Unlinked branch "${linkedBranch}" from issue #${issue}.`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Error unlinking branch: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

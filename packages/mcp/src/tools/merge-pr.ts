import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { spawnSync } from 'child_process';
import { validateNumericInput } from '@bretwardjames/ghp-core';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'merge_pr',
    category: 'action',
    disabledByDefault: true,
};

/**
 * Registers the merge_pr tool.
 * Merges a pull request.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'merge_pr',
        {
            title: 'Merge Pull Request',
            description:
                'Merge a pull request. Supports merge, squash, and rebase strategies.',
            inputSchema: {
                number: z.number().describe('PR number to merge'),
                method: z
                    .enum(['merge', 'squash', 'rebase'])
                    .optional()
                    .describe('Merge method (default: squash)'),
                deleteHead: z
                    .boolean()
                    .optional()
                    .describe('Delete head branch after merge (default: true)'),
            },
        },
        async ({ number, method = 'squash', deleteHead = true }) => {
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
                // Validate PR number to prevent injection
                const safePrNumber = validateNumericInput(number, 'PR number');

                // Build gh pr merge command args
                const args = ['pr', 'merge', String(safePrNumber)];

                // Add merge method flag
                if (method === 'squash') {
                    args.push('--squash');
                } else if (method === 'rebase') {
                    args.push('--rebase');
                } else {
                    args.push('--merge');
                }

                // Add delete branch flag
                if (deleteHead) {
                    args.push('--delete-branch');
                }

                // Execute gh pr merge
                const result = spawnSync('gh', args, {
                    encoding: 'utf-8',
                    cwd: process.cwd(),
                    env: process.env,
                });

                if (result.status !== 0) {
                    const errorMessage = result.stderr || `gh pr merge failed with exit code ${result.status}`;
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `Error merging PR: ${errorMessage}`,
                            },
                        ],
                        isError: true,
                    };
                }

                let message = `Merged PR #${number} using ${method} strategy.`;
                if (deleteHead) {
                    message += ' Head branch deleted.';
                }

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: message,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Error merging PR: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listWorktrees, extractIssueNumberFromBranch } from '@bretwardjames/ghp-core';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'list_worktrees',
    category: 'read',
    disabledByDefault: true,
};

/**
 * Registers the list_worktrees tool.
 * Lists all active git worktrees.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'list_worktrees',
        {
            title: 'List Worktrees',
            description:
                'List all active git worktrees. Shows path, branch, and linked issue for each.',
            inputSchema: {},
        },
        async () => {
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
                const worktrees = await listWorktrees();

                if (worktrees.length === 0) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: 'No worktrees found.',
                            },
                        ],
                    };
                }

                // Format worktree info
                const lines = worktrees.map(wt => {
                    const issueNum = wt.branch ? extractIssueNumberFromBranch(wt.branch) : null;
                    const parts = [
                        `Path: ${wt.path}`,
                        `Branch: ${wt.branch || '(detached)'}`,
                    ];

                    if (wt.isMain) {
                        parts.push('(main worktree)');
                    }

                    if (issueNum) {
                        parts.push(`Issue: #${issueNum}`);
                    }

                    return parts.join('\n  ');
                });

                const message = `Found ${worktrees.length} worktree(s):\n\n${lines.join('\n\n')}`;

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
                            text: `Error listing worktrees: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

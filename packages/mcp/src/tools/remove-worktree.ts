import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { removeWorktreeWorkflow, validateNumericInput, validateSafeString } from '@bretwardjames/ghp-core';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';
import { loadHooksConfig } from '../tool-registry.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'remove_worktree',
    category: 'action',
    disabledByDefault: true,
};

/**
 * Registers the remove_worktree tool.
 * Removes a git worktree.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'remove_worktree',
        {
            title: 'Remove Worktree',
            description:
                'Remove a git worktree by issue number or path. Fires worktree-removed hook.',
            inputSchema: {
                issue: z
                    .number()
                    .optional()
                    .describe('Issue number to find and remove worktree for'),
                path: z
                    .string()
                    .optional()
                    .describe('Direct path to the worktree to remove'),
                force: z
                    .boolean()
                    .optional()
                    .describe('Force removal even with uncommitted changes'),
            },
        },
        async ({ issue, path, force }) => {
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

            if (!issue && !path) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: 'Error: Either issue number or path must be provided.',
                        },
                    ],
                    isError: true,
                };
            }

            try {
                // Validate inputs
                const safeIssue = issue ? validateNumericInput(issue, 'issue') : undefined;
                const safePath = path ? validateSafeString(path, 'path') : undefined;

                // Get issue title if we have an issue number
                let issueTitle: string | undefined;
                if (safeIssue) {
                    const item = await context.api.findItemByNumber(repo, safeIssue);
                    if (item) {
                        issueTitle = item.title;
                    }
                }

                const hooksConfig = loadHooksConfig();

                const result = await removeWorktreeWorkflow({
                    repo,
                    issueNumber: safeIssue || 0,
                    issueTitle,
                    worktreePath: safePath,
                    force: force || false,
                    onFailure: hooksConfig.onFailure,
                });

                if (!result.success) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `Error removing worktree: ${result.error}`,
                            },
                        ],
                        isError: true,
                    };
                }

                let message = `Removed worktree at ${result.worktree!.path}`;
                if (result.branch) {
                    message += ` (branch: ${result.branch})`;
                }

                // Report hook results
                const successHooks = result.hookResults.filter(h => h.success).length;
                const failedHooks = result.hookResults.length - successHooks;
                if (result.hookResults.length > 0) {
                    message += `\n\nHooks: ${successHooks} succeeded`;
                    if (failedHooks > 0) {
                        message += `, ${failedHooks} failed`;
                    }
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
                            text: `Error removing worktree: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

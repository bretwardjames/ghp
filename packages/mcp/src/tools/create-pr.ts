import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';
import { loadHooksConfig, getConfigValue } from '../tool-registry.js';
import {
    createPRWorkflow,
    getCurrentBranch,
    extractIssueNumberFromBranch,
} from '@bretwardjames/ghp-core';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'create_pr',
    category: 'action',
    disabledByDefault: true,
};

/**
 * Registers the create_pr tool.
 * Creates a pull request for the current branch.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'create_pr',
        {
            title: 'Create Pull Request',
            description:
                'Create a pull request for the current branch. Optionally link to an issue.',
            inputSchema: {
                title: z.string().describe('PR title'),
                body: z.string().optional().describe('PR description/body'),
                baseBranch: z
                    .string()
                    .optional()
                    .describe('Target branch (default: main)'),
                issueNumber: z
                    .number()
                    .optional()
                    .describe('Issue number to link (adds "Relates to #N" to body)'),
                skipHooks: z
                    .boolean()
                    .optional()
                    .describe('Skip pre-pr and pr-creating hooks'),
                force: z
                    .boolean()
                    .optional()
                    .describe('Force creation even if blocking hooks fail'),
            },
        },
        async ({ title, body, baseBranch, issueNumber, skipHooks, force }) => {
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
                const currentBranch = await getCurrentBranch();
                if (!currentBranch) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: 'Error: Could not determine current branch.',
                            },
                        ],
                        isError: true,
                    };
                }

                // Try to extract issue number from branch if not provided
                const linkedIssue = issueNumber ?? extractIssueNumberFromBranch(currentBranch);

                // Get issue title if we have a linked issue
                let issueTitle: string | undefined;
                if (linkedIssue) {
                    const item = await context.api.findItemByNumber(repo, linkedIssue);
                    if (item) {
                        issueTitle = item.title;
                    }
                }

                const hooksConfig = loadHooksConfig();

                const result = await createPRWorkflow({
                    repo,
                    title,
                    body,
                    baseBranch: baseBranch || 'main',
                    headBranch: currentBranch,
                    issueNumber: linkedIssue,
                    issueTitle,
                    skipHooks: skipHooks || false,
                    force: force || false,
                    onFailure: hooksConfig.onFailure,
                });

                if (!result.success) {
                    // Check if aborted by hook
                    if (result.abortedByHook) {
                        return {
                            content: [
                                {
                                    type: 'text' as const,
                                    text: `PR creation aborted by ${result.abortedAtEvent} hook "${result.abortedByHook}". Use force=true to override.`,
                                },
                            ],
                            isError: true,
                        };
                    }

                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `Error creating PR: ${result.error}`,
                            },
                        ],
                        isError: true,
                    };
                }

                // Move linked issue to prOpenedStatus
                let statusMoveMessage = '';
                if (linkedIssue) {
                    const prOpenedStatus = getConfigValue('prOpenedStatus', 'In Review');
                    if (prOpenedStatus) {
                        const moveResult = await context.api.moveIssueToStatus(repo, linkedIssue, prOpenedStatus);
                        if (moveResult.success) {
                            statusMoveMessage = `\nMoved #${linkedIssue} to "${prOpenedStatus}"`;
                        } else if (moveResult.error) {
                            statusMoveMessage = `\nCould not move #${linkedIssue}: ${moveResult.error}`;
                        }
                    }
                }

                // Build success message
                let message = `Created PR #${result.pr!.number}: ${result.pr!.title}\n\nURL: ${result.pr!.url}`;

                if (result.issue) {
                    message += `\nLinked to issue #${result.issue.number}`;
                }
                message += statusMoveMessage;

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
                            text: `Error creating PR: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

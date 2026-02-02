import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';
import { loadHooksConfig } from '../tool-registry.js';
import {
    getCurrentBranch,
    executeHooksForEvent,
    hasHooksForEvent,
    type IssueStartedPayload,
} from '@bretwardjames/ghp-core';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'start_work',
    category: 'action',
};

/**
 * Registers the start_work tool.
 * Marks an issue as "In Progress" (or similar starting status).
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'start_work',
        {
            title: 'Start Work',
            description:
                'Start working on an issue by setting its status to "In Progress". Note: Branch creation is not supported in MCP context - use the CLI for that.',
            inputSchema: {
                issue: z.number().describe('Issue number to start working on'),
                updateStatus: z
                    .boolean()
                    .optional()
                    .describe('Whether to update the status (default: true)'),
            },
        },
        async ({ issue, updateStatus = true }) => {
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

                // Check for blocking issues
                const openBlockers = item.blockedBy?.filter(b => b.state === 'OPEN') || [];
                const blockingWarning = openBlockers.length > 0
                    ? `\n\nWARNING: This issue is blocked by: ${openBlockers.map(b => `#${b.number} (${b.title})`).join(', ')}`
                    : '';

                if (!updateStatus) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Started work on issue #${issue} "${item.title}" (status not updated).${blockingWarning}`,
                            },
                        ],
                    };
                }

                // Get status field options
                const statusField = await context.api.getStatusField(item.projectId);
                if (!statusField) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'Could not find Status field in the project.',
                            },
                        ],
                        isError: true,
                    };
                }

                // Find "In Progress" or similar status
                const inProgressOption = statusField.options.find(
                    (opt) =>
                        opt.name.toLowerCase() === 'in progress' ||
                        opt.name.toLowerCase() === 'in-progress' ||
                        opt.name.toLowerCase() === 'doing'
                );
                if (!inProgressOption) {
                    const available = statusField.options.map((o) => o.name).join(', ');
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `No "In Progress" status found. Available statuses: ${available}. Use move_issue to set a specific status.`,
                            },
                        ],
                        isError: true,
                    };
                }

                // Update the status
                const success = await context.api.updateItemStatus(
                    item.projectId,
                    item.id,
                    statusField.fieldId,
                    inProgressOption.id
                );

                if (!success) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'Failed to update issue status.',
                            },
                        ],
                        isError: true,
                    };
                }

                // Fire issue-started hook
                let hookInfo = '';
                if (hasHooksForEvent('issue-started')) {
                    const branch = await getCurrentBranch() || '';
                    const payload: IssueStartedPayload = {
                        repo: `${repo.owner}/${repo.name}`,
                        issue: {
                            number: issue,
                            title: item.title,
                            body: '', // Body not available from ProjectItem
                            url: `https://github.com/${repo.owner}/${repo.name}/issues/${issue}`,
                        },
                        branch,
                    };

                    const hooksConfig = loadHooksConfig();
                    const hookResults = await executeHooksForEvent('issue-started', payload, {
                        onFailure: hooksConfig.onFailure,
                    });
                    const successCount = hookResults.filter(r => r.success).length;
                    const failCount = hookResults.length - successCount;

                    if (hookResults.length > 0) {
                        hookInfo = `\n\nHooks: ${successCount} succeeded`;
                        if (failCount > 0) {
                            hookInfo += `, ${failCount} failed`;
                        }
                    }
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Started work on issue #${issue} "${item.title}" - status set to "${inProgressOption.name}".${blockingWarning}${hookInfo}`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error starting work: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

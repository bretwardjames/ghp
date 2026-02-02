import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { validateNumericInput } from '@bretwardjames/ghp-core';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'get_issue',
    category: 'read',
    disabledByDefault: true,
};

/**
 * Registers the get_issue tool.
 * Gets full details for an issue including body, comments, and relationships.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'get_issue',
        {
            title: 'Get Issue Details',
            description:
                'Get full details for an issue including body, comments, status, labels, and relationships.',
            inputSchema: {
                issue: z.number().describe('Issue number'),
                includeComments: z
                    .boolean()
                    .optional()
                    .describe('Include comments in output (default: true)'),
            },
        },
        async ({ issue, includeComments = true }) => {
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

                // Get issue details and project item info in parallel
                const [details, projectItem, relationships] = await Promise.all([
                    context.api.getIssueDetails(repo, safeIssue),
                    context.api.findItemByNumber(repo, safeIssue),
                    context.api.getIssueRelationships(repo, safeIssue),
                ]);

                if (!details) {
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

                // Build output
                const lines: string[] = [];

                // Header
                lines.push(`# Issue #${issue}: ${details.title}`);
                lines.push('');

                // Metadata
                lines.push(`**State:** ${details.state}`);
                lines.push(`**Author:** @${details.author}`);
                lines.push(`**Created:** ${new Date(details.createdAt).toLocaleDateString()}`);

                if (projectItem?.status) {
                    lines.push(`**Status:** ${projectItem.status}`);
                }

                if (details.labels.length > 0) {
                    lines.push(`**Labels:** ${details.labels.map(l => l.name).join(', ')}`);
                }

                if (projectItem?.assignees && projectItem.assignees.length > 0) {
                    lines.push(`**Assignees:** ${projectItem.assignees.map(a => `@${a}`).join(', ')}`);
                }

                // URL
                lines.push(`**URL:** https://github.com/${repo.owner}/${repo.name}/issues/${issue}`);

                // Relationships
                if (relationships) {
                    if (relationships.parent) {
                        lines.push(`**Parent:** #${relationships.parent.number} - ${relationships.parent.title}`);
                    }

                    if (relationships.subIssues.length > 0) {
                        lines.push(`**Sub-issues:** ${relationships.subIssues.map(s => `#${s.number}`).join(', ')}`);
                    }

                    if (relationships.blockedBy.length > 0) {
                        lines.push(`**Blocked by:** ${relationships.blockedBy.map(b => `#${b.number}`).join(', ')}`);
                    }

                    if (relationships.blocking.length > 0) {
                        lines.push(`**Blocking:** ${relationships.blocking.map(b => `#${b.number}`).join(', ')}`);
                    }
                }

                // Body
                lines.push('');
                lines.push('## Description');
                lines.push('');
                lines.push(details.body || '*No description provided.*');

                // Comments
                if (includeComments && details.comments.length > 0) {
                    lines.push('');
                    lines.push(`## Comments (${details.totalComments} total)`);
                    lines.push('');

                    for (const comment of details.comments) {
                        const date = new Date(comment.createdAt).toLocaleDateString();
                        lines.push(`### @${comment.author} on ${date}`);
                        lines.push('');
                        lines.push(comment.body);
                        lines.push('');
                    }

                    if (details.totalComments > details.comments.length) {
                        lines.push(`*... and ${details.totalComments - details.comments.length} more comments*`);
                    }
                }

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: lines.join('\n'),
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Error getting issue: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

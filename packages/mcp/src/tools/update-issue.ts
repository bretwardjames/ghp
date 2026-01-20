import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';

/**
 * Registers the update_issue tool.
 * Updates an existing GitHub issue's title and/or body.
 */
export function registerUpdateIssueTool(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'update_issue',
        {
            title: 'Update Issue',
            description:
                'Update an existing GitHub issue. Can modify the title, body/description, or both.',
            inputSchema: {
                issue: z.string().describe('Issue number (e.g., "123" or "#123")'),
                title: z
                    .string()
                    .optional()
                    .describe('New issue title (leave empty to keep current)'),
                body: z
                    .string()
                    .optional()
                    .describe('New issue body/description (leave empty to keep current)'),
            },
        },
        async ({ issue, title, body }) => {
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

            // Parse issue number
            const issueNumber = parseInt(issue.replace(/^#/, ''), 10);
            if (isNaN(issueNumber)) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: Invalid issue number "${issue}".`,
                        },
                    ],
                    isError: true,
                };
            }

            // Must provide at least one field to update
            if (!title && !body) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Error: Must provide at least one of title or body to update.',
                        },
                    ],
                    isError: true,
                };
            }

            try {
                // Get current issue details first
                const details = await context.api.getIssueDetails(repo, issueNumber);
                if (!details) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Error: Issue #${issueNumber} not found.`,
                            },
                        ],
                        isError: true,
                    };
                }

                // Update the issue
                const success = await context.api.updateIssue(repo, issueNumber, {
                    title: title || undefined,
                    body: body || undefined,
                });

                if (!success) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Error: Failed to update issue #${issueNumber}.`,
                            },
                        ],
                        isError: true,
                    };
                }

                const changes = [];
                if (title) changes.push('title');
                if (body) changes.push('body');

                const issueUrl = `https://github.com/${repo.owner}/${repo.name}/issues/${issueNumber}`;

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Updated issue #${issueNumber} (${changes.join(', ')})\n${issueUrl}`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error updating issue: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

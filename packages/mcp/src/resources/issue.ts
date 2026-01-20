import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../server.js';

/**
 * Registers the ghp://issue/{number} resource template.
 * Returns details about a specific issue including comments.
 */
export function registerIssueResource(server: McpServer, context: ServerContext): void {
    server.registerResource(
        'issue',
        new ResourceTemplate('ghp://issue/{number}', { list: undefined }),
        {
            title: 'Issue Details',
            description: 'Detailed information about a specific issue including comments',
            mimeType: 'application/json',
        },
        async (uri, { number }) => {
            const authenticated = await context.ensureAuthenticated();
            if (!authenticated) {
                return {
                    contents: [
                        {
                            uri: uri.href,
                            mimeType: 'application/json',
                            text: JSON.stringify({ error: 'Not authenticated' }),
                        },
                    ],
                };
            }

            const repo = await context.getRepo();
            if (!repo) {
                return {
                    contents: [
                        {
                            uri: uri.href,
                            mimeType: 'application/json',
                            text: JSON.stringify({ error: 'Not in a git repository' }),
                        },
                    ],
                };
            }

            try {
                const issueNumber = parseInt(number as string, 10);
                if (isNaN(issueNumber)) {
                    return {
                        contents: [
                            {
                                uri: uri.href,
                                mimeType: 'application/json',
                                text: JSON.stringify({ error: 'Invalid issue number' }),
                            },
                        ],
                    };
                }

                const details = await context.api.getIssueDetails(repo, issueNumber);
                if (!details) {
                    return {
                        contents: [
                            {
                                uri: uri.href,
                                mimeType: 'application/json',
                                text: JSON.stringify({ error: `Issue #${issueNumber} not found` }),
                            },
                        ],
                    };
                }

                // Also get project item info if available
                const projectItem = await context.api.findItemByNumber(repo, issueNumber);

                const result = {
                    number: issueNumber,
                    ...details,
                    project: projectItem
                        ? {
                              name: projectItem.projectTitle,
                              status: projectItem.status,
                              fields: projectItem.fields,
                          }
                        : null,
                    url: `https://github.com/${repo.owner}/${repo.name}/issues/${issueNumber}`,
                };

                return {
                    contents: [
                        {
                            uri: uri.href,
                            mimeType: 'application/json',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            } catch (error) {
                return {
                    contents: [
                        {
                            uri: uri.href,
                            mimeType: 'application/json',
                            text: JSON.stringify({
                                error: error instanceof Error ? error.message : String(error),
                            }),
                        },
                    ],
                };
            }
        }
    );
}

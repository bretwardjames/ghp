import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'add_comment',
    category: 'action',
};

/**
 * Registers the add_comment tool.
 * Adds a comment to a GitHub issue.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'add_comment',
        {
            title: 'Add Comment',
            description: 'Add a comment to a GitHub issue or pull request.',
            inputSchema: {
                issue: z.number().describe('Issue or PR number'),
                body: z.string().describe('Comment text (supports Markdown)'),
            },
        },
        async ({ issue, body }) => {
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
                const success = await context.api.addComment(repo, issue, body);

                if (success) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Added comment to issue #${issue}.`,
                            },
                        ],
                    };
                } else {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'Failed to add comment.',
                            },
                        ],
                        isError: true,
                    };
                }
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error adding comment: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

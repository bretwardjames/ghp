import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';
import { listTags } from '@bretwardjames/ghp-core';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'get_tags',
    category: 'read',
};

/**
 * Registers the get_tags tool.
 * Lists git tags in the repository, sorted newest first.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'get_tags',
        {
            title: 'Get Tags',
            description:
                'List git tags in the repository, sorted newest first. Useful for discovering available tags for hotfix branches with start_work.',
            inputSchema: {
                limit: z
                    .number()
                    .optional()
                    .describe('Maximum number of tags to return (default: 20)'),
            },
        },
        async ({ limit = 20 }) => {
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
                const tags = await listTags();
                const limited = tags.slice(0, limit);

                if (limited.length === 0) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'No tags found in this repository.',
                            },
                        ],
                    };
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                total: tags.length,
                                showing: limited.length,
                                tags: limited,
                            }, null, 2),
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error listing tags: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

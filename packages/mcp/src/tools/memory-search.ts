import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'memory_search',
    category: 'memory',
};

/**
 * Registers the memory_search tool.
 * Searches memories by query with optional namespace filter.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'memory_search',
        {
            title: 'Search Memories',
            description: 'Search for memories by query. Optionally filter by namespace.',
            inputSchema: {
                query: z.string().describe('Search query to find relevant memories'),
                namespace: z.string().optional().describe('Optional namespace to search within'),
                limit: z.number().optional().describe('Maximum number of results (default: 10)'),
            },
        },
        async ({ query, namespace, limit }) => {
            try {
                const results = await context.memory.search({
                    query,
                    namespace,
                    limit: limit ?? 10,
                });

                if (results.length === 0) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `No memories found matching "${query}"${namespace ? ` in namespace "${namespace}"` : ''}.`,
                            },
                        ],
                    };
                }

                const formatted = results.map((r, i) => {
                    const lines = [
                        `[${i + 1}] ID: ${r.memory.id} (score: ${r.score.toFixed(2)})`,
                        `    Namespace: ${r.memory.namespace}`,
                        `    Content: ${r.memory.content.substring(0, 200)}${r.memory.content.length > 200 ? '...' : ''}`,
                    ];
                    if (r.memory.metadata && Object.keys(r.memory.metadata).length > 0) {
                        lines.push(`    Metadata: ${JSON.stringify(r.memory.metadata)}`);
                    }
                    return lines.join('\n');
                }).join('\n\n');

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Found ${results.length} memories:\n\n${formatted}`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error searching memories: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

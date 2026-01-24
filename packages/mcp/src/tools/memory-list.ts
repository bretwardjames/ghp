import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'memory_list',
    category: 'memory',
};

/**
 * Registers the memory_list tool.
 * Lists all memories in a namespace.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'memory_list',
        {
            title: 'List Memories',
            description: 'List all memories in a specific namespace.',
            inputSchema: {
                namespace: z.string().describe('Namespace to list memories from'),
                limit: z.number().optional().describe('Maximum number of results (default: 50)'),
                offset: z.number().optional().describe('Offset for pagination'),
            },
        },
        async ({ namespace, limit, offset }) => {
            try {
                const memories = await context.memory.list({
                    namespace,
                    limit: limit ?? 50,
                    offset,
                });

                if (memories.length === 0) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `No memories found in namespace "${namespace}".`,
                            },
                        ],
                    };
                }

                const formatted = memories.map((m, i) => {
                    const lines = [
                        `[${i + 1}] ID: ${m.id}`,
                        `    Created: ${m.createdAt.toISOString()}`,
                        `    Content: ${m.content.substring(0, 150)}${m.content.length > 150 ? '...' : ''}`,
                    ];
                    return lines.join('\n');
                }).join('\n\n');

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Found ${memories.length} memories in "${namespace}":\n\n${formatted}`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error listing memories: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

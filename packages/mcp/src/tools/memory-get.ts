import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'memory_get',
    category: 'memory',
};

/**
 * Registers the memory_get tool.
 * Gets a specific memory by ID.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'memory_get',
        {
            title: 'Get Memory',
            description: 'Retrieve a specific memory by its ID.',
            inputSchema: {
                id: z.string().describe('The ID of the memory to retrieve'),
            },
        },
        async ({ id }) => {
            try {
                const memory = await context.memory.get(id);

                if (!memory) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Memory with ID "${id}" not found.`,
                            },
                        ],
                        isError: true,
                    };
                }

                const lines = [
                    `ID: ${memory.id}`,
                    `Namespace: ${memory.namespace}`,
                    `Created: ${memory.createdAt.toISOString()}`,
                    `Updated: ${memory.updatedAt.toISOString()}`,
                    '',
                    'Content:',
                    memory.content,
                ];

                if (memory.metadata && Object.keys(memory.metadata).length > 0) {
                    lines.push('', 'Metadata:', JSON.stringify(memory.metadata, null, 2));
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: lines.join('\n'),
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error retrieving memory: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

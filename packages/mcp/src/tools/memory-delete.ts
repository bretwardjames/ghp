import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'memory_delete',
    category: 'memory',
};

/**
 * Registers the memory_delete tool.
 * Deletes a specific memory by ID.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'memory_delete',
        {
            title: 'Delete Memory',
            description: 'Delete a specific memory by its ID.',
            inputSchema: {
                id: z.string().describe('The ID of the memory to delete'),
            },
        },
        async ({ id }) => {
            try {
                const deleted = await context.memory.delete(id);

                if (deleted) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Successfully deleted memory with ID: ${id}`,
                            },
                        ],
                    };
                } else {
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
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error deleting memory: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

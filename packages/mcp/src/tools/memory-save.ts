import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'memory_save',
    category: 'memory',
};

/**
 * Registers the memory_save tool.
 * Saves content to memory with a namespace.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'memory_save',
        {
            title: 'Save Memory',
            description: 'Save content to memory with a namespace for later retrieval.',
            inputSchema: {
                namespace: z.string().describe('Namespace to store the memory in (e.g., "issue-123", "project-notes")'),
                content: z.string().describe('The content to save'),
                metadata: z.record(z.unknown()).optional().describe('Optional metadata to attach to the memory'),
            },
        },
        async ({ namespace, content, metadata }) => {
            try {
                const memory = await context.memory.save({
                    namespace,
                    content,
                    metadata,
                });

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Saved memory with ID: ${memory.id}\nNamespace: ${namespace}\nCreated: ${memory.createdAt.toISOString()}`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error saving memory: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

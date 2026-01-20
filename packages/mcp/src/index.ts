#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { createTokenProvider } from './auth/token-provider.js';
import { registerAllTools } from './tools/index.js';
import { registerAllResources } from './resources/index.js';

/**
 * ghp MCP Server
 *
 * Exposes GitHub Projects functionality to AI assistants via the
 * Model Context Protocol.
 *
 * Usage:
 *   node dist/index.js
 *
 * Or configure in Claude Desktop:
 *   {
 *     "mcpServers": {
 *       "ghp": {
 *         "command": "node",
 *         "args": ["/path/to/ghp/packages/mcp/dist/index.js"]
 *       }
 *     }
 *   }
 */
async function main(): Promise<void> {
    const tokenProvider = createTokenProvider();
    const { server, context } = createServer(tokenProvider);

    // Register all tools and resources
    registerAllTools(server, context);
    registerAllResources(server, context);

    // Connect via stdio
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((error) => {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
});

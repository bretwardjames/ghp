#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { RepoInfo } from '@bretwardjames/ghp-core';
import { createServer } from './server.js';
import { createTokenProvider } from './auth/token-provider.js';
import { registerEnabledTools } from './tool-registry.js';
import { registerAllResources } from './resources/index.js';

/**
 * ghp MCP Server
 *
 * Exposes GitHub Projects functionality to AI assistants via the
 * Model Context Protocol.
 *
 * Usage:
 *   ghp-mcp                         # auto-detect repo from cwd
 *   ghp-mcp --repo owner/name       # lock to a specific repo
 */

function parseRepoArg(): RepoInfo | undefined {
    const idx = process.argv.indexOf('--repo');
    if (idx === -1) {
        return undefined;
    }

    const value = process.argv[idx + 1];
    if (!value || !value.includes('/')) {
        console.error('Error: --repo requires owner/name format (e.g., --repo bretwardjames/ghp)');
        process.exit(1);
    }

    const [owner, ...rest] = value.split('/');
    const name = rest.join('/');
    return { owner, name, fullName: `${owner}/${name}` };
}

async function main(): Promise<void> {
    const lockedRepo = parseRepoArg();
    const tokenProvider = createTokenProvider();
    const { server, context } = createServer(tokenProvider, lockedRepo);

    // Register all tools and resources
    registerEnabledTools(server, context);
    registerAllResources(server, context);

    // Connect via stdio
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((error) => {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
});

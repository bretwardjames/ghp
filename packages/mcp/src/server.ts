import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GitHubAPI, type TokenProvider, type RepoInfo } from '@bretwardjames/ghp-core';
import { createRequire } from 'module';
import { RepoContext } from './context/repo-context.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

export interface ServerContext {
    api: GitHubAPI;
    repoContext: RepoContext;
    getRepo: () => Promise<RepoInfo | null>;
    ensureAuthenticated: () => Promise<boolean>;
}

/**
 * Creates and configures the MCP server with all tools and resources.
 */
export function createServer(tokenProvider: TokenProvider): {
    server: McpServer;
    context: ServerContext;
} {
    const server = new McpServer({
        name: 'ghp',
        version: pkg.version,
    });

    const api = new GitHubAPI({ tokenProvider });
    const repoContext = new RepoContext();

    const context: ServerContext = {
        api,
        repoContext,
        getRepo: () => repoContext.getRepo(),
        ensureAuthenticated: async () => {
            if (api.isAuthenticated) {
                return true;
            }
            return api.authenticate();
        },
    };

    return { server, context };
}

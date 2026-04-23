#!/usr/bin/env node

import { createApp } from './http-server.js';
import { loadConfig } from './config.js';
import { assertHostedMode } from './mode-guard.js';

/**
 * ghp-mcp-hosted — HTTP-transport MCP server for hosted / multi-tenant
 * platforms (runtight, custom AI products).
 *
 * Env:
 *   GHP_MCP_MODE                      (required) must be 'hosted'
 *   GHP_REPO                          (required) owner/name lock for every session
 *   GHP_GITHUB_OAUTH_CLIENT_ID        (required) GitHub OAuth App client id
 *   GHP_GITHUB_OAUTH_CLIENT_SECRET    (required) GitHub OAuth App client secret
 *   GHP_ALLOWED_REDIRECT_URIS         (required) comma-separated client redirect_uri allowlist
 *   PORT                              (default 8731)
 *   GHP_HOSTED_BASE_URL               (required in production) public https URL
 *   GHP_ALLOWED_ORIGINS               (default '*') CORS allowlist
 *   GHP_OAUTH_STATE_TTL_SECONDS       (default 600)
 *   NODE_ENV                          (default 'development')
 */
async function main(): Promise<void> {
    assertHostedMode();
    const config = loadConfig();
    const app = createApp(config);

    const server = app.listen(config.port, () => {
        console.log(
            JSON.stringify({
                level: 'info',
                msg: 'ghp-mcp-hosted listening',
                port: config.port,
                baseUrl: config.baseUrl ?? null,
                lockedRepo: config.lockedRepo ?? null,
                nodeEnv: config.nodeEnv,
            })
        );
    });

    const shutdown = (signal: string): void => {
        console.log(JSON.stringify({ level: 'info', msg: 'shutting down', signal }));
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
    console.error(
        JSON.stringify({
            level: 'fatal',
            msg: 'failed to start ghp-mcp-hosted',
            error: err instanceof Error ? err.message : String(err),
        })
    );
    process.exit(1);
});

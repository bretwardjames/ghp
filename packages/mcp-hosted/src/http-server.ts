import express, { type Application, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
    createServer as createMcpServer,
    registerEnabledTools,
    pureApiTools,
    type McpConfig,
} from '@bretwardjames/ghp-mcp';
import type { RepoInfo } from '@bretwardjames/ghp-core';
import { BearerTokenProvider, extractBearer } from './auth/bearer-token-provider.js';
import type { HostedConfig } from './config.js';
import { parseRepoInfo } from './config.js';
import { assertHostedSafe } from './mode-guard.js';

/**
 * Build the Express app for the hosted GHP MCP server.
 *
 * The app has three kinds of routes:
 *   - GET  /healthz                 — plaintext probe for Railway / Fly
 *   - GET  /.well-known/oauth-*     — OAuth discovery stubs (#279 fills in)
 *   - POST /mcp                     — MCP Streamable HTTP endpoint
 *
 * /mcp creates a fresh McpServer + transport per request. The request's
 * Bearer token is bound to a request-scoped TokenProvider. Tools are
 * registered via `registerEnabledTools(..., 'pure-api')` so only the
 * hosted-safe subset is ever exposed.
 */
export function createApp(config: HostedConfig): Application {
    // One-time capability audit at startup. pureApiTools is already filtered
    // by capability === 'pure-api', but re-asserting here catches the case
    // where the list is ever regenerated in a future refactor and something
    // local-only slips in. Doing this at createApp time rather than per
    // request avoids paying the cost on every tool call.
    for (const tool of pureApiTools) {
        assertHostedSafe(tool.meta);
    }

    // Pre-resolve the locked repo once. Hosted mode requires GHP_REPO (the
    // config schema enforces this), so this never branches into the auto
    // detect path that would shell out to `git remote get-url origin` on
    // the host machine — something we never want in a multi-tenant server.
    const lockedRepo: RepoInfo = parseRepoInfo(config.lockedRepo);

    // Pre-build a deterministic McpConfig for every request. Passing this
    // explicitly prevents registerEnabledTools from falling back to
    // loadMcpConfig(), which reads ~/.config/ghp-cli/config.json and runs
    // `git rev-parse --show-toplevel` — behavior that is wrong for a
    // multi-tenant server and would spawn a subprocess per request.
    const mcpConfig: McpConfig = {
        tools: { read: true, action: true },
        disabledTools: [],
    };

    const app = express();
    app.disable('x-powered-by');

    app.use(
        express.json({
            limit: '1mb',
            // MCP Streamable HTTP expects the raw JSON-RPC body to be
            // available on req.body. 1MB is generous for tool calls.
        })
    );

    // Permissive CORS for dev; real allowlist handled in #279 alongside OAuth.
    app.use((_req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', config.allowedOrigins);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader(
            'Access-Control-Allow-Headers',
            'Content-Type, Authorization, MCP-Protocol-Version'
        );
        next();
    });

    // CORS preflight: browsers issue OPTIONS before any cross-origin POST
    // that carries Authorization or non-simple Content-Type. Without this
    // handler, the preflight would 404 and the POST would be blocked
    // client-side.
    app.options('/mcp', (_req, res) => {
        res.sendStatus(204);
    });

    app.get('/healthz', (_req, res) => {
        res.type('text/plain').send('ok');
    });

    // OAuth discovery stubs — filled in by #279. Returning 501 here keeps
    // the routes documented without silently 404-ing clients that probe.
    app.get('/.well-known/oauth-protected-resource', (_req, res) => {
        res.status(501).json({
            error: 'not_implemented',
            error_description:
                'OAuth discovery is not implemented in this build. Use a PAT via Authorization: Bearer <token>.',
        });
    });

    app.get('/.well-known/oauth-authorization-server', (_req, res) => {
        res.status(501).json({
            error: 'not_implemented',
            error_description:
                'OAuth authorization server metadata is not implemented in this build.',
        });
    });

    app.post('/mcp', (req, res) =>
        handleMcpRequest(req, res, { config, lockedRepo, mcpConfig })
    );

    return app;
}

interface RequestDeps {
    config: HostedConfig;
    lockedRepo: RepoInfo;
    mcpConfig: McpConfig;
}

async function handleMcpRequest(
    req: Request,
    res: Response,
    deps: RequestDeps
): Promise<void> {
    const token = extractBearer(req.header('authorization'));
    if (!token) {
        sendUnauthorized(res, deps.config);
        return;
    }

    const tokenProvider = new BearerTokenProvider(token);
    const { server, context } = createMcpServer(tokenProvider, deps.lockedRepo);
    registerEnabledTools(server, context, deps.mcpConfig, 'pure-api');

    const transport = new StreamableHTTPServerTransport({
        // Stateless per-request mode: no session IDs, no cross-request state.
        // Matches the multi-tenant requirement — each request is a fresh
        // tenant boundary.
        sessionIdGenerator: undefined,
    });

    try {
        await server.connect(transport);

        // Register cleanup after connect so we never try to close an
        // uninitialized transport if the client disconnects during connect.
        res.on('close', () => {
            void transport.close();
            void server.close();
        });

        await transport.handleRequest(req, res, req.body);
    } catch (err) {
        // If connect/handleRequest throws before any response was sent,
        // return a JSON-RPC-shaped error so the client sees it as a
        // protocol failure rather than a connection reset.
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message:
                        err instanceof Error
                            ? err.message
                            : 'Internal error handling MCP request',
                },
                id: null,
            });
        }
    }
}

function sendUnauthorized(res: Response, config: HostedConfig): void {
    // Per MCP Authorization spec, surface a WWW-Authenticate header that
    // points at the Protected Resource Metadata document. Even though
    // that endpoint is a stub in this build, the header shape is
    // correct so future MCP clients can discover OAuth once #279 lands.
    const resourceMetadata = config.baseUrl
        ? `${config.baseUrl}/.well-known/oauth-protected-resource`
        : '/.well-known/oauth-protected-resource';
    res.setHeader(
        'WWW-Authenticate',
        `Bearer realm="ghp-mcp-hosted", resource_metadata="${resourceMetadata}"`
    );
    res.status(401).json({
        jsonrpc: '2.0',
        error: {
            code: -32001,
            message: 'Missing or invalid Authorization header. Expected "Bearer <token>".',
        },
        id: null,
    });
}

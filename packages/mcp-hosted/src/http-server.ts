import express, { type Application, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
    createServer as createMcpServer,
    registerEnabledTools,
    pureApiTools,
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

    app.post('/mcp', (req, res) => handleMcpRequest(req, res, config));

    return app;
}

async function handleMcpRequest(
    req: Request,
    res: Response,
    config: HostedConfig
): Promise<void> {
    const token = extractBearer(req.header('authorization'));
    if (!token) {
        sendUnauthorized(res, config);
        return;
    }

    const tokenProvider = new BearerTokenProvider(token);
    const lockedRepo: RepoInfo | undefined = config.lockedRepo
        ? parseRepoInfo(config.lockedRepo)
        : undefined;

    const { server, context } = createMcpServer(tokenProvider, lockedRepo);

    // Defence-in-depth: every pure-api tool passes assertHostedSafe;
    // a local-only tool sneaking in would throw before register().
    for (const tool of pureApiTools) {
        assertHostedSafe(tool.meta);
    }
    registerEnabledTools(server, context, undefined, 'pure-api');

    const transport = new StreamableHTTPServerTransport({
        // Stateless per-request mode: no session IDs, no cross-request state.
        // Matches the multi-tenant requirement — each request is a fresh
        // tenant boundary.
        sessionIdGenerator: undefined,
    });

    // When the client closes the stream we also close our handle so the
    // request never dangles. Without this, long-running tool calls that
    // the client abandons would keep the McpServer alive.
    res.on('close', () => {
        void transport.close();
        void server.close();
    });

    try {
        await server.connect(transport);
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

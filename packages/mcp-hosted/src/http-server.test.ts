/**
 * Integration tests for the hosted MCP HTTP server.
 *
 * These exercise the Express app in-process via supertest. They do NOT
 * require any network access or a real GitHub token:
 *   - `/healthz` and `/.well-known/*` are pure responses.
 *   - `/mcp` `initialize` + `tools/list` route through the MCP SDK but
 *     never touch GitHub (tools are only invoked via `tools/call`).
 *
 * A fake bearer satisfies the Authorization extraction; the downstream
 * TokenProvider is only read when a tool handler actually calls the API.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from './http-server.js';
import type { HostedConfig } from './config.js';

const FAKE_TOKEN = 'ghp_faketoken_for_tests_1234567890';

function buildConfig(overrides: Partial<HostedConfig> = {}): HostedConfig {
    return {
        port: 0,
        mode: 'hosted',
        baseUrl: 'https://ghp-mcp-hosted.test',
        lockedRepo: 'bretwardjames/ghp',
        allowedOrigins: '*',
        githubOauthClientId: 'test-github-client-id',
        githubOauthClientSecret: 'test-github-client-secret',
        allowedRedirectUris: 'https://runtight.test/oauth/callback',
        oauthStateTtlSeconds: 600,
        nodeEnv: 'test',
        ...overrides,
    };
}

function mcpHeaders(token: string = FAKE_TOKEN) {
    return {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
    };
}

describe('hosted http server', () => {
    let app: ReturnType<typeof createApp>;
    beforeEach(() => {
        app = createApp(buildConfig());
    });

    describe('/healthz', () => {
        it('returns 200 and "ok"', async () => {
            const res = await request(app).get('/healthz');
            expect(res.status).toBe(200);
            expect(res.text).toBe('ok');
        });
    });

    describe('/.well-known/oauth-protected-resource', () => {
        it('returns RFC 9728 metadata pointing at ourselves as the AS', async () => {
            const res = await request(app).get('/.well-known/oauth-protected-resource');
            expect(res.status).toBe(200);
            expect(res.body.resource).toBe('https://ghp-mcp-hosted.test');
            expect(res.body.authorization_servers).toEqual([
                'https://ghp-mcp-hosted.test',
            ]);
            expect(res.body.bearer_methods_supported).toContain('header');
        });
    });

    describe('/.well-known/oauth-authorization-server', () => {
        it('returns RFC 8414 metadata with PKCE S256 declared', async () => {
            const res = await request(app).get('/.well-known/oauth-authorization-server');
            expect(res.status).toBe(200);
            expect(res.body.issuer).toBe('https://ghp-mcp-hosted.test');
            expect(res.body.authorization_endpoint).toMatch(/\/oauth\/authorize$/);
            expect(res.body.token_endpoint).toMatch(/\/oauth\/token$/);
            expect(res.body.code_challenge_methods_supported).toEqual(['S256']);
            expect(res.body.grant_types_supported).toContain('authorization_code');
        });
    });

    describe('POST /mcp without auth', () => {
        it('returns 401 with WWW-Authenticate pointing at resource metadata', async () => {
            const res = await request(app)
                .post('/mcp')
                .set('Content-Type', 'application/json')
                .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

            expect(res.status).toBe(401);
            expect(res.headers['www-authenticate']).toMatch(/^Bearer /);
            expect(res.headers['www-authenticate']).toContain(
                'resource_metadata="https://ghp-mcp-hosted.test/.well-known/oauth-protected-resource"'
            );
            expect(res.body.error.code).toBe(-32001);
        });

        it('rejects malformed Authorization (scheme missing)', async () => {
            const res = await request(app)
                .post('/mcp')
                .set('Authorization', 'not-a-bearer-header')
                .set('Content-Type', 'application/json')
                .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
            expect(res.status).toBe(401);
        });

        it('rejects too-short tokens', async () => {
            const res = await request(app)
                .post('/mcp')
                .set('Authorization', 'Bearer short')
                .set('Content-Type', 'application/json')
                .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
            expect(res.status).toBe(401);
        });
    });

    describe('CORS', () => {
        it('responds 204 to OPTIONS preflight so browsers can POST', async () => {
            const res = await request(app)
                .options('/mcp')
                .set('Origin', 'https://example.com')
                .set('Access-Control-Request-Method', 'POST')
                .set('Access-Control-Request-Headers', 'Authorization, Content-Type');
            expect(res.status).toBe(204);
            expect(res.headers['access-control-allow-methods']).toContain('POST');
            expect(res.headers['access-control-allow-headers']).toContain('Authorization');
        });
    });

    describe('POST /mcp with auth — MCP protocol', () => {
        it('initializes successfully', async () => {
            const res = await request(app)
                .post('/mcp')
                .set(mcpHeaders())
                .send({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: {
                        protocolVersion: '2025-06-18',
                        capabilities: {},
                        clientInfo: { name: 'vitest', version: '1' },
                    },
                });

            expect(res.status).toBe(200);
            // StreamableHTTP returns SSE-framed JSON; parse the data line.
            const parsed = parseMcpResponse(res.text);
            expect(parsed.result.serverInfo.name).toBe('ghp');
            expect(parsed.result.protocolVersion).toBeDefined();
        });

        it('concurrent requests with different tokens do not share state', async () => {
            // Fire two tools/list requests with different bearers in parallel.
            // If any module-level state (token provider, repo context, tool
            // registration) leaked across requests, we'd see inconsistent tool
            // lists or error/success asymmetry. Both should return identical
            // pure-api tool sets.
            const tokenA = 'ghp_tenant_A_fake_token_000000001';
            const tokenB = 'ghp_tenant_B_fake_token_000000002';

            const [resA, resB] = await Promise.all([
                request(app)
                    .post('/mcp')
                    .set(mcpHeaders(tokenA))
                    .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
                request(app)
                    .post('/mcp')
                    .set(mcpHeaders(tokenB))
                    .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
            ]);

            expect(resA.status).toBe(200);
            expect(resB.status).toBe(200);

            const namesA = parseMcpResponse(resA.text)
                .result.tools.map((t: { name: string }) => t.name)
                .sort();
            const namesB = parseMcpResponse(resB.text)
                .result.tools.map((t: { name: string }) => t.name)
                .sort();

            expect(namesA).toEqual(namesB);
            expect(namesA).toContain('get_my_work');
            expect(namesA).not.toContain('create_worktree');
        });

        it('tools/list contains only pure-api tools', async () => {
            const res = await request(app)
                .post('/mcp')
                .set(mcpHeaders())
                .send({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/list',
                    params: {},
                });

            expect(res.status).toBe(200);
            const parsed = parseMcpResponse(res.text);
            const names: string[] = parsed.result.tools.map((t: { name: string }) => t.name);

            // Pure-api sample — must be present (these are enabled by default)
            expect(names).toContain('get_my_work');
            expect(names).toContain('get_project_board');
            expect(names).toContain('move_issue');
            expect(names).toContain('update_issue');
            // stop_work is pure-api but disabledByDefault — not registered here,
            // which is fine. Hosted deployments that want it can opt in via
            // the existing enabledTools config surface.
            expect(names).not.toContain('stop_work');

            // Local-only — must NEVER be exposed on the hosted server
            expect(names).not.toContain('create_worktree');
            expect(names).not.toContain('remove_worktree');
            expect(names).not.toContain('list_worktrees');
            expect(names).not.toContain('merge_pr');
            expect(names).not.toContain('create_pr');
            expect(names).not.toContain('release');
            expect(names).not.toContain('sync_merged_prs');
            expect(names).not.toContain('start_work');
            expect(names).not.toContain('get_tags');
            // create_issue is now pure-api on hosted: its hook dispatch
            // is gated behind GHP_MCP_MODE=hosted (see #288).
            expect(names).toContain('create_issue');
        });
    });
});

/**
 * StreamableHTTPServerTransport responds with an SSE-framed single event
 * `event: message\ndata: {json}\n\n`. This tiny parser pulls the JSON out
 * so tests can make assertions on the payload without pulling in an SSE
 * client.
 */
function parseMcpResponse(text: string): { result: any } {
    const line = text
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('data:'));
    if (!line) throw new Error(`No data: line in response: ${text}`);
    return JSON.parse(line.slice('data:'.length).trim());
}

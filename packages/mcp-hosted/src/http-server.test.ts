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
        baseUrl: undefined,
        lockedRepo: 'bretwardjames/ghp',
        allowedOrigins: '*',
        logLevel: 'error',
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
        it('returns 501 stub until OAuth ships in #279', async () => {
            const res = await request(app).get('/.well-known/oauth-protected-resource');
            expect(res.status).toBe(501);
            expect(res.body.error).toBe('not_implemented');
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
                'resource_metadata="/.well-known/oauth-protected-resource"'
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
            // create_issue is local-only until #278 hook gate lands
            expect(names).not.toContain('create_issue');
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

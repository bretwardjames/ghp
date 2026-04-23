/**
 * Integration tests for the OAuth 2.1 + PKCE + RFC 9728 flow.
 *
 * The GitHub token endpoint is mocked via a fetch stub so these tests
 * never hit github.com. The full 3-leg flow is exercised: authorize →
 * redirect to GitHub → (fake) callback → token exchange.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createHash } from 'crypto';
import { createApp } from '../http-server.js';
import type { HostedConfig } from '../config.js';

const CLIENT_REDIRECT = 'https://runtight.test/oauth/callback';

function buildConfig(overrides: Partial<HostedConfig> = {}): HostedConfig {
    return {
        port: 0,
        mode: 'hosted',
        baseUrl: 'https://ghp-mcp-hosted.test',
        lockedRepo: 'bretwardjames/ghp',
        allowedOrigins: '*',
        githubOauthClientId: 'github-client-id',
        githubOauthClientSecret: 'github-client-secret',
        allowedRedirectUris: CLIENT_REDIRECT,
        oauthStateTtlSeconds: 600,
        nodeEnv: 'test',
        ...overrides,
    };
}

function base64UrlSha256(input: string): string {
    return createHash('sha256')
        .update(input)
        .digest('base64')
        .replace(/=+$/, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

// A legal PKCE verifier + its S256 challenge.
const VERIFIER = 'A'.repeat(64);
const CHALLENGE = base64UrlSha256(VERIFIER);

describe('OAuth flow', () => {
    let app: ReturnType<typeof createApp>;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        // Mock the global fetch used inside exchangeGithubCode. The OAuth
        // deps don't expose a fetchImpl hook through createApp yet, so
        // overriding globalThis.fetch is the simplest path.
        fetchMock = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    access_token: 'ghp_FAKE_GITHUB_TOKEN_0123456789',
                    scope: 'read:project,project,repo',
                    token_type: 'bearer',
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        );
        vi.stubGlobal('fetch', fetchMock);

        app = createApp(buildConfig());
    });

    describe('/oauth/register', () => {
        it('returns a static client_id when redirect_uris are allowlisted', async () => {
            const res = await request(app)
                .post('/oauth/register')
                .send({ redirect_uris: [CLIENT_REDIRECT] });
            expect(res.status).toBe(201);
            expect(res.body.client_id).toBeTruthy();
            expect(res.body.token_endpoint_auth_method).toBe('none');
        });

        it('rejects non-allowlisted redirect_uris', async () => {
            const res = await request(app)
                .post('/oauth/register')
                .send({ redirect_uris: ['https://evil.example.com/cb'] });
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('invalid_redirect_uri');
        });
    });

    describe('/oauth/authorize', () => {
        it('redirects to GitHub with a server-side state', async () => {
            const res = await request(app).get('/oauth/authorize').query({
                response_type: 'code',
                client_id: 'ghp-mcp-hosted-public-client',
                redirect_uri: CLIENT_REDIRECT,
                state: 'client-state',
                code_challenge: CHALLENGE,
                code_challenge_method: 'S256',
            });

            expect(res.status).toBe(302);
            const location = res.headers.location;
            expect(location).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize/);
            const url = new URL(location);
            expect(url.searchParams.get('client_id')).toBe('github-client-id');
            expect(url.searchParams.get('redirect_uri')).toBe(
                'https://ghp-mcp-hosted.test/oauth/callback'
            );
            // Must NOT leak the client's original state to GitHub —
            // GitHub gets *our* state.
            expect(url.searchParams.get('state')).not.toBe('client-state');
            expect(url.searchParams.get('state')).toBeTruthy();
        });

        it('rejects a non-allowlisted redirect_uri with 400 (no redirect)', async () => {
            const res = await request(app).get('/oauth/authorize').query({
                response_type: 'code',
                client_id: 'public',
                redirect_uri: 'https://evil.example.com/cb',
                state: 'x',
                code_challenge: CHALLENGE,
                code_challenge_method: 'S256',
            });
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('invalid_redirect_uri');
        });

        it('rejects response_type != code', async () => {
            const res = await request(app).get('/oauth/authorize').query({
                response_type: 'token',
                client_id: 'public',
                redirect_uri: CLIENT_REDIRECT,
                state: 'x',
                code_challenge: CHALLENGE,
                code_challenge_method: 'S256',
            });
            // recoverable error bounces to client redirect
            expect(res.status).toBe(302);
            const loc = new URL(res.headers.location);
            expect(loc.searchParams.get('error')).toBe('unsupported_response_type');
        });

        it('rejects missing PKCE challenge', async () => {
            const res = await request(app).get('/oauth/authorize').query({
                response_type: 'code',
                client_id: 'public',
                redirect_uri: CLIENT_REDIRECT,
                state: 'x',
                code_challenge_method: 'S256',
            });
            expect(res.status).toBe(302);
            const loc = new URL(res.headers.location);
            expect(loc.searchParams.get('error')).toBe('invalid_request');
        });
    });

    describe('/oauth/callback', () => {
        it('exchanges GitHub code, mints our own code, redirects to client', async () => {
            // Seed an authorize request to produce a valid server state.
            const authorizeRes = await request(app).get('/oauth/authorize').query({
                response_type: 'code',
                client_id: 'public',
                redirect_uri: CLIENT_REDIRECT,
                state: 'client-state',
                code_challenge: CHALLENGE,
                code_challenge_method: 'S256',
            });
            const githubUrl = new URL(authorizeRes.headers.location);
            const serverState = githubUrl.searchParams.get('state');
            expect(serverState).toBeTruthy();

            const callbackRes = await request(app).get('/oauth/callback').query({
                code: 'github-code-123',
                state: serverState,
            });
            expect(callbackRes.status).toBe(302);
            const redirect = new URL(callbackRes.headers.location);
            expect(redirect.origin + redirect.pathname).toBe(CLIENT_REDIRECT);
            expect(redirect.searchParams.get('state')).toBe('client-state');
            expect(redirect.searchParams.get('code')).toBeTruthy();

            // fetch to GitHub token endpoint was called exactly once
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(fetchMock.mock.calls[0][0]).toBe(
                'https://github.com/login/oauth/access_token'
            );
        });

        it('rejects unknown state', async () => {
            const res = await request(app).get('/oauth/callback').query({
                code: 'github-code-123',
                state: 'never-issued',
            });
            expect(res.status).toBe(400);
        });

        it('surfaces GitHub consent errors back to the client', async () => {
            const res = await request(app).get('/oauth/callback').query({
                error: 'access_denied',
            });
            expect(res.status).toBe(400);
            expect(res.text).toContain('access_denied');
        });
    });

    describe('/oauth/token — full flow', () => {
        async function runThroughAuthorize(): Promise<string> {
            // Authorize → extract server state
            const authorizeRes = await request(app).get('/oauth/authorize').query({
                response_type: 'code',
                client_id: 'public',
                redirect_uri: CLIENT_REDIRECT,
                state: 'client-state',
                code_challenge: CHALLENGE,
                code_challenge_method: 'S256',
            });
            const serverState = new URL(authorizeRes.headers.location).searchParams.get(
                'state'
            )!;

            // Callback → extract our auth code
            const callbackRes = await request(app).get('/oauth/callback').query({
                code: 'github-code-123',
                state: serverState,
            });
            return new URL(callbackRes.headers.location).searchParams.get('code')!;
        }

        it('returns the GitHub token when PKCE + redirect_uri match', async () => {
            const code = await runThroughAuthorize();

            const res = await request(app)
                .post('/oauth/token')
                .type('form')
                .send({
                    grant_type: 'authorization_code',
                    code,
                    code_verifier: VERIFIER,
                    redirect_uri: CLIENT_REDIRECT,
                });

            expect(res.status).toBe(200);
            expect(res.body.access_token).toBe('ghp_FAKE_GITHUB_TOKEN_0123456789');
            expect(res.body.token_type).toBe('Bearer');
        });

        it('rejects a bad PKCE verifier', async () => {
            const code = await runThroughAuthorize();

            const res = await request(app)
                .post('/oauth/token')
                .type('form')
                .send({
                    grant_type: 'authorization_code',
                    code,
                    code_verifier: 'X'.repeat(64),
                    redirect_uri: CLIENT_REDIRECT,
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('invalid_grant');
        });

        it('rejects a redirect_uri mismatch', async () => {
            const code = await runThroughAuthorize();

            const res = await request(app)
                .post('/oauth/token')
                .type('form')
                .send({
                    grant_type: 'authorization_code',
                    code,
                    code_verifier: VERIFIER,
                    redirect_uri: 'https://runtight.test/wrong',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('invalid_grant');
        });

        it('rejects reuse of an auth code (single-use)', async () => {
            const code = await runThroughAuthorize();

            const first = await request(app)
                .post('/oauth/token')
                .type('form')
                .send({
                    grant_type: 'authorization_code',
                    code,
                    code_verifier: VERIFIER,
                    redirect_uri: CLIENT_REDIRECT,
                });
            expect(first.status).toBe(200);

            const second = await request(app)
                .post('/oauth/token')
                .type('form')
                .send({
                    grant_type: 'authorization_code',
                    code,
                    code_verifier: VERIFIER,
                    redirect_uri: CLIENT_REDIRECT,
                });
            expect(second.status).toBe(400);
            expect(second.body.error).toBe('invalid_grant');
        });

        it('rejects unsupported grant_type', async () => {
            const res = await request(app)
                .post('/oauth/token')
                .type('form')
                .send({
                    grant_type: 'password',
                    code: 'x',
                    code_verifier: 'y',
                    redirect_uri: CLIENT_REDIRECT,
                });
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('unsupported_grant_type');
        });
    });

    describe('TTL expiry', () => {
        it('/oauth/callback rejects an expired server state', async () => {
            vi.useFakeTimers({ now: Date.now() });
            try {
                const appWithShortTtl = createApp(
                    buildConfig({ oauthStateTtlSeconds: 60 })
                );

                const authorizeRes = await request(appWithShortTtl)
                    .get('/oauth/authorize')
                    .query({
                        response_type: 'code',
                        client_id: 'public',
                        redirect_uri: CLIENT_REDIRECT,
                        state: 'client-state',
                        code_challenge: CHALLENGE,
                        code_challenge_method: 'S256',
                    });
                const serverState = new URL(
                    authorizeRes.headers.location
                ).searchParams.get('state')!;

                vi.advanceTimersByTime(61_000); // past 60s TTL

                const callbackRes = await request(appWithShortTtl)
                    .get('/oauth/callback')
                    .query({
                        code: 'github-code-123',
                        state: serverState,
                    });
                expect(callbackRes.status).toBe(400);
            } finally {
                vi.useRealTimers();
            }
        });

        it('/oauth/token rejects an expired auth code', async () => {
            vi.useFakeTimers({ now: Date.now() });
            try {
                const appWithShortTtl = createApp(
                    buildConfig({ oauthStateTtlSeconds: 60 })
                );

                const authorizeRes = await request(appWithShortTtl)
                    .get('/oauth/authorize')
                    .query({
                        response_type: 'code',
                        client_id: 'public',
                        redirect_uri: CLIENT_REDIRECT,
                        state: 'client-state',
                        code_challenge: CHALLENGE,
                        code_challenge_method: 'S256',
                    });
                const serverState = new URL(
                    authorizeRes.headers.location
                ).searchParams.get('state')!;

                const callbackRes = await request(appWithShortTtl)
                    .get('/oauth/callback')
                    .query({
                        code: 'github-code-123',
                        state: serverState,
                    });
                const authCode = new URL(
                    callbackRes.headers.location
                ).searchParams.get('code')!;

                vi.advanceTimersByTime(61_000);

                const tokenRes = await request(appWithShortTtl)
                    .post('/oauth/token')
                    .type('form')
                    .send({
                        grant_type: 'authorization_code',
                        code: authCode,
                        code_verifier: VERIFIER,
                        redirect_uri: CLIENT_REDIRECT,
                    });
                expect(tokenRes.status).toBe(400);
                expect(tokenRes.body.error).toBe('invalid_grant');
            } finally {
                vi.useRealTimers();
            }
        });
    });
});

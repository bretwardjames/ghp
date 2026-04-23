import { randomBytes } from 'crypto';
import type { Request, Response, Application } from 'express';
import type { HostedConfig } from '../config.js';
import {
    StateStore,
    StateStoreCapacityError,
    type AuthorizeContext,
    type AuthCodeContext,
} from './state-store.js';
import { verifyPkce, isValidChallenge } from './pkce.js';
import {
    buildGithubAuthorizeUrl,
    exchangeGithubCode,
    GithubExchangeError,
    REQUIRED_GITHUB_SCOPES,
} from './github.js';
import {
    oauthProtectedResourceMetadata,
    oauthAuthorizationServerMetadata,
} from './well-known.js';

/**
 * Runtime config scoped to OAuth. Passed through from the top-level
 * HostedConfig plus the two OAuth-App credentials, because those are
 * sensitive enough that we want them explicit at every layer.
 */
export interface OAuthDeps {
    config: HostedConfig;
    githubClientId: string;
    githubClientSecret: string;
    /** Allowlist of exact redirect_uris accepted from MCP clients. */
    allowedRedirectUris: readonly string[];
    authorizeStore: StateStore<AuthorizeContext>;
    authCodeStore: StateStore<AuthCodeContext>;
    /** Overridable for tests; defaults to the global fetch. */
    fetchImpl?: typeof fetch;
}

export function mountOAuthRoutes(app: Application, deps: OAuthDeps): void {
    app.get('/.well-known/oauth-protected-resource', (_req, res) => {
        res.json(oauthProtectedResourceMetadata(deps.config));
    });

    app.get('/.well-known/oauth-authorization-server', (_req, res) => {
        res.json(oauthAuthorizationServerMetadata(deps.config));
    });

    app.post('/oauth/register', (req, res) => handleRegister(req, res, deps));
    app.get('/oauth/authorize', (req, res) => handleAuthorize(req, res, deps));
    app.get('/oauth/callback', (req, res) => handleCallback(req, res, deps));
    app.post('/oauth/token', (req, res) => handleToken(req, res, deps));
}

/**
 * RFC 7591 Dynamic Client Registration — v1 stub.
 *
 * We don't actually persist client records yet. The MCP client hands us
 * a redirect_uri it intends to use; we validate it against the allowlist
 * and echo back a stable client_id. When we move to multi-tenant with
 * real client accounting this becomes a DB insert.
 */
function handleRegister(req: Request, res: Response, deps: OAuthDeps): void {
    const body = req.body as { redirect_uris?: unknown } | undefined;
    const rawRedirects = Array.isArray(body?.redirect_uris)
        ? (body!.redirect_uris as unknown[])
        : [];
    const redirectUris = rawRedirects.filter(
        (u): u is string => typeof u === 'string'
    );

    if (redirectUris.length === 0) {
        res.status(400).json({
            error: 'invalid_redirect_uri',
            error_description: 'At least one redirect_uri is required.',
        });
        return;
    }

    for (const uri of redirectUris) {
        if (!deps.allowedRedirectUris.includes(uri)) {
            res.status(400).json({
                error: 'invalid_redirect_uri',
                error_description: `redirect_uri '${uri}' is not in the server allowlist.`,
            });
            return;
        }
    }

    // Stable public-client id. No secret — PKCE is the client
    // authentication mechanism.
    res.status(201).json({
        client_id: 'ghp-mcp-hosted-public-client',
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        scope: REQUIRED_GITHUB_SCOPES.join(' '),
    });
}

/**
 * /oauth/authorize — first leg of the flow. The MCP client (or user's
 * browser acting on its behalf) lands here with PKCE and redirect info.
 * We stash that into the authorize store keyed by a fresh server-side
 * state and bounce the user to github.com for consent.
 */
function handleAuthorize(req: Request, res: Response, deps: OAuthDeps): void {
    const {
        client_id: clientId,
        redirect_uri: clientRedirectUri,
        state: clientState,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
        response_type: responseType,
    } = req.query as Record<string, string | undefined>;

    if (responseType !== 'code') {
        sendAuthorizeError(res, clientRedirectUri, clientState, {
            error: 'unsupported_response_type',
            error_description: 'Only response_type=code is supported.',
        });
        return;
    }
    if (!clientId) {
        sendAuthorizeError(res, clientRedirectUri, clientState, {
            error: 'invalid_request',
            error_description: 'Missing client_id.',
        });
        return;
    }
    if (!clientRedirectUri || !deps.allowedRedirectUris.includes(clientRedirectUri)) {
        // Do NOT redirect — the redirect target is itself untrusted.
        // Surface the error in the response body instead.
        res.status(400).json({
            error: 'invalid_redirect_uri',
            error_description:
                'redirect_uri is missing or not in the server allowlist.',
        });
        return;
    }
    if (!codeChallenge || !isValidChallenge(codeChallenge)) {
        sendAuthorizeError(res, clientRedirectUri, clientState, {
            error: 'invalid_request',
            error_description:
                'PKCE code_challenge is required and must be a 43-char base64url-encoded SHA-256 digest.',
        });
        return;
    }
    if (codeChallengeMethod !== 'S256') {
        sendAuthorizeError(res, clientRedirectUri, clientState, {
            error: 'invalid_request',
            error_description: 'Only code_challenge_method=S256 is supported.',
        });
        return;
    }

    const serverState = randomToken(32);
    try {
        deps.authorizeStore.set(serverState, {
            codeChallenge,
            clientRedirectUri,
            clientState: clientState ?? '',
            clientId,
            createdAt: Date.now(),
        });
    } catch (err) {
        if (err instanceof StateStoreCapacityError) {
            res.setHeader('Retry-After', '60');
            res.status(503).json({
                error: 'server_error',
                error_description:
                    'Authorization server is temporarily at capacity. Retry shortly.',
            });
            return;
        }
        throw err;
    }

    const githubCallback = `${baseUrl(deps.config)}/oauth/callback`;
    const githubUrl = buildGithubAuthorizeUrl({
        clientId: deps.githubClientId,
        redirectUri: githubCallback,
        state: serverState,
    });

    res.redirect(302, githubUrl);
}

/**
 * /oauth/callback — GitHub sends the user here with ?code=...&state=...
 * after consent. We recover the original client context by server-side
 * state, exchange GitHub's code for an access token, mint our own auth
 * code keyed to the client's PKCE challenge, and redirect the user
 * back to the MCP client's redirect_uri.
 */
async function handleCallback(
    req: Request,
    res: Response,
    deps: OAuthDeps
): Promise<void> {
    const { code, state, error } = req.query as Record<string, string | undefined>;

    if (error) {
        res.status(400).type('text/plain').send(
            `GitHub returned an error during consent: ${error}. You may close this window.`
        );
        return;
    }
    if (!code || !state) {
        res.status(400).type('text/plain').send(
            'Missing code or state. You may close this window.'
        );
        return;
    }

    const authCtx = deps.authorizeStore.take(state);
    if (!authCtx) {
        res.status(400).type('text/plain').send(
            'Unknown or expired state. Start the flow again.'
        );
        return;
    }

    let githubToken;
    try {
        githubToken = await exchangeGithubCode(
            {
                clientId: deps.githubClientId,
                clientSecret: deps.githubClientSecret,
            },
            code,
            `${baseUrl(deps.config)}/oauth/callback`,
            deps.fetchImpl
        );
    } catch (err) {
        // Log the real reason server-side; surface only a generic
        // message to the client via the redirect. Echoing GitHub's
        // error_description to an attacker-controlled redirect could
        // leak operational detail about our OAuth App state.
        console.error(
            JSON.stringify({
                level: 'warn',
                msg: 'github_token_exchange_failed',
                error:
                    err instanceof GithubExchangeError
                        ? err.message
                        : err instanceof Error
                          ? err.message
                          : String(err),
            })
        );
        sendAuthorizeError(res, authCtx.clientRedirectUri, authCtx.clientState, {
            error: 'server_error',
            error_description:
                'Upstream authorization server rejected the code exchange.',
        });
        return;
    }

    const authCode = randomToken(32);
    deps.authCodeStore.set(authCode, {
        githubAccessToken: githubToken.accessToken,
        scope: githubToken.scope,
        codeChallenge: authCtx.codeChallenge,
        clientRedirectUri: authCtx.clientRedirectUri,
        createdAt: Date.now(),
    });

    const redirect = new URL(authCtx.clientRedirectUri);
    redirect.searchParams.set('code', authCode);
    if (authCtx.clientState) {
        redirect.searchParams.set('state', authCtx.clientState);
    }
    res.redirect(302, redirect.toString());
}

/**
 * /oauth/token — last leg. The MCP client POSTs the auth code back
 * together with its PKCE code_verifier. We verify PKCE, verify the
 * redirect_uri matches, consume the entry, and return the underlying
 * GitHub Bearer token.
 */
function handleToken(req: Request, res: Response, deps: OAuthDeps): void {
    const body = req.body as Record<string, unknown>;

    if (body.grant_type !== 'authorization_code') {
        res.status(400).json({
            error: 'unsupported_grant_type',
            error_description: 'Only authorization_code is supported.',
        });
        return;
    }

    const code = typeof body.code === 'string' ? body.code : '';
    const verifier = typeof body.code_verifier === 'string' ? body.code_verifier : '';
    const redirectUri = typeof body.redirect_uri === 'string' ? body.redirect_uri : '';

    if (!code || !verifier || !redirectUri) {
        res.status(400).json({
            error: 'invalid_request',
            error_description: 'code, code_verifier, and redirect_uri are required.',
        });
        return;
    }

    const entry = deps.authCodeStore.take(code);
    if (!entry) {
        res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Authorization code is unknown, expired, or already used.',
        });
        return;
    }

    if (entry.clientRedirectUri !== redirectUri) {
        res.status(400).json({
            error: 'invalid_grant',
            error_description: 'redirect_uri does not match the original authorization request.',
        });
        return;
    }

    if (!verifyPkce(verifier, entry.codeChallenge)) {
        res.status(400).json({
            error: 'invalid_grant',
            error_description: 'PKCE code_verifier does not match the stored challenge.',
        });
        return;
    }

    // Pass-through strategy (v1): hand the GitHub access token
    // straight to the MCP client. Revocation and rotation are
    // therefore GitHub-controlled. Wrapping tokens would sit here in
    // a future iteration.
    res.json({
        access_token: entry.githubAccessToken,
        token_type: 'Bearer',
        scope: entry.scope,
    });
}

/**
 * Redirect a recoverable error back to the client's redirect_uri per
 * RFC 6749 §4.1.2.1. When the redirect_uri itself is untrusted, the
 * caller must NOT use this helper — return a plain response instead.
 */
function sendAuthorizeError(
    res: Response,
    clientRedirectUri: string | undefined,
    clientState: string | undefined,
    err: { error: string; error_description: string }
): void {
    if (!clientRedirectUri) {
        res.status(400).json(err);
        return;
    }
    const url = new URL(clientRedirectUri);
    url.searchParams.set('error', err.error);
    url.searchParams.set('error_description', err.error_description);
    if (clientState) url.searchParams.set('state', clientState);
    res.redirect(302, url.toString());
}

function randomToken(bytes: number): string {
    return randomBytes(bytes)
        .toString('base64')
        .replace(/=+$/, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function baseUrl(config: HostedConfig): string {
    if (config.baseUrl) return config.baseUrl.replace(/\/+$/, '');
    return `http://localhost:${config.port}`;
}

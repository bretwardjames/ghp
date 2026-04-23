/**
 * Thin client for GitHub's OAuth App endpoints. Deliberately minimal —
 * we only need:
 *
 *   - build the authorize URL the user gets redirected to
 *   - exchange the authorization code for a Bearer access token
 *
 * GitHub OAuth Apps do NOT support PKCE directly, so we mediate PKCE on
 * our side (see state-store + token handler) and use only the
 * client_id/client_secret/state flow at GitHub's endpoint.
 */

export interface GithubOauthConfig {
    clientId: string;
    clientSecret: string;
}

export interface GithubTokenResponse {
    accessToken: string;
    scope: string;
    tokenType: string;
}

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

/**
 * Required scopes for the pure-api tool surface. `repo` is broad but
 * required for issue mutations on private repos; narrower scopes
 * (`public_repo`) work for OSS-only deployments — wire up an option if
 * we ever need it.
 */
export const REQUIRED_GITHUB_SCOPES = ['read:project', 'project', 'repo'];

export function buildGithubAuthorizeUrl(params: {
    clientId: string;
    redirectUri: string;
    state: string;
    scopes?: string[];
}): string {
    const url = new URL(GITHUB_AUTHORIZE_URL);
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('state', params.state);
    url.searchParams.set(
        'scope',
        (params.scopes ?? REQUIRED_GITHUB_SCOPES).join(' ')
    );
    return url.toString();
}

/**
 * Exchange a GitHub authorization code for an access token. Throws on
 * non-2xx response or when GitHub returns an error body. Callers should
 * surface the error upstream as an OAuth2 `invalid_grant` or
 * `server_error` depending on shape.
 */
export async function exchangeGithubCode(
    config: GithubOauthConfig,
    code: string,
    redirectUri: string,
    fetchImpl: typeof fetch = fetch
): Promise<GithubTokenResponse> {
    const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: redirectUri,
    });

    const res = await fetchImpl(GITHUB_TOKEN_URL, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'ghp-mcp-hosted',
        },
        body: body.toString(),
    });

    if (!res.ok) {
        throw new Error(
            `GitHub token exchange failed: HTTP ${res.status} ${res.statusText}`
        );
    }

    const payload = (await res.json()) as Record<string, unknown>;
    if (payload.error) {
        throw new Error(
            `GitHub token exchange error: ${String(payload.error)} - ${String(
                payload.error_description ?? ''
            )}`
        );
    }

    const accessToken = payload.access_token;
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
        throw new Error('GitHub token exchange returned no access_token');
    }

    return {
        accessToken,
        scope: typeof payload.scope === 'string' ? payload.scope : '',
        tokenType:
            typeof payload.token_type === 'string' ? payload.token_type : 'bearer',
    };
}

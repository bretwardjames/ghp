import type { HostedConfig } from '../config.js';
import { REQUIRED_GITHUB_SCOPES } from './github.js';

/**
 * RFC 9728 "Protected Resource Metadata". MCP clients (like runtight)
 * fetch this at the URL advertised via WWW-Authenticate to discover
 * which authorization server guards this resource.
 */
export function oauthProtectedResourceMetadata(config: HostedConfig): {
    resource: string;
    authorization_servers: string[];
    scopes_supported: string[];
    bearer_methods_supported: string[];
} {
    const base = requireBaseUrl(config);
    return {
        resource: base,
        authorization_servers: [base],
        scopes_supported: REQUIRED_GITHUB_SCOPES,
        bearer_methods_supported: ['header'],
    };
}

/**
 * RFC 8414 "Authorization Server Metadata". Describes our OAuth
 * endpoints and the features we support. MCP clients use this to
 * drive the authorization flow without hardcoding our URL shapes.
 */
export function oauthAuthorizationServerMetadata(config: HostedConfig): {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint: string;
    response_types_supported: string[];
    grant_types_supported: string[];
    code_challenge_methods_supported: string[];
    token_endpoint_auth_methods_supported: string[];
    scopes_supported: string[];
} {
    const base = requireBaseUrl(config);
    return {
        issuer: base,
        authorization_endpoint: `${base}/oauth/authorize`,
        token_endpoint: `${base}/oauth/token`,
        registration_endpoint: `${base}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        code_challenge_methods_supported: ['S256'],
        // 'none' = public client (PKCE-only). We don't accept client secrets
        // from the MCP client — the only secret in play is the GitHub
        // OAuth App client_secret, which is server-side.
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: REQUIRED_GITHUB_SCOPES,
    };
}

/**
 * Both metadata docs embed absolute URLs, so the server must know its
 * public origin. In development this can fall back to a localhost URL,
 * but for any real client interaction baseUrl must be set.
 */
function requireBaseUrl(config: HostedConfig): string {
    if (config.baseUrl) return config.baseUrl.replace(/\/+$/, '');
    // Dev fallback — authorize flow still won't round-trip against
    // GitHub without a reachable baseUrl, but /.well-known returning
    // *something* is better than 500 during local smoke tests.
    return `http://localhost:${config.port}`;
}

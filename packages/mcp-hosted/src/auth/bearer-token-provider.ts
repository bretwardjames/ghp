import type { TokenProvider } from '@bretwardjames/ghp-core';

/**
 * Request-scoped TokenProvider that wraps a static Bearer token extracted
 * from an HTTP `Authorization: Bearer <token>` header.
 *
 * One instance per HTTP request — NEVER cache across requests. The hosted
 * server is multi-tenant; reusing a provider would leak one user's token
 * into another user's tool call.
 */
export class BearerTokenProvider implements TokenProvider {
    constructor(private readonly token: string) {
        if (!token) {
            throw new Error('BearerTokenProvider requires a non-empty token');
        }
    }

    async getToken(): Promise<string | null> {
        return this.token;
    }
}

/**
 * Parse a raw Authorization header and return the bearer token, or null
 * when the header is missing/malformed.
 *
 * Accepts "Bearer <token>" (case-insensitive scheme). Rejects token strings
 * shorter than 8 chars as a cheap sanity check — a real GitHub token is
 * always much longer.
 */
export function extractBearer(header: string | undefined): string | null {
    if (!header) return null;
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (!match) return null;
    const token = match[1];
    if (token.length < 8) return null;
    return token;
}

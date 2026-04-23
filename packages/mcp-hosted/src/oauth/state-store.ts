/**
 * Ephemeral in-memory TTL store for OAuth authorization state and issued
 * auth codes. Used for:
 *
 *   - "state" tracking: when a client hits /oauth/authorize, we generate
 *     our own server-side state key and stash the client's PKCE challenge,
 *     redirect_uri, and original state under it. On /oauth/callback we
 *     look up by our state key and recover the original context.
 *
 *   - "auth codes": after the GitHub token exchange succeeds we mint our
 *     own opaque code, bind it to the GitHub access token plus the
 *     client's PKCE challenge + redirect_uri, and return it to the
 *     client. The client exchanges it at /oauth/token; we verify PKCE,
 *     return the GitHub token, and delete the entry (single-use).
 *
 * Single-instance only. For horizontal scaling swap with Redis — the
 * interface here is deliberately small so that's a straight replacement.
 */

export interface AuthorizeContext {
    /** The client's PKCE code_challenge (method is always S256). */
    codeChallenge: string;
    /** The redirect_uri the client asked us to bounce back to. */
    clientRedirectUri: string;
    /** The client's original state value, echoed back unchanged on redirect. */
    clientState: string;
    /** Static client_id the client registered with (or the v1 default). */
    clientId: string;
    /** Epoch ms; record is garbage-collected after ttlMs elapses. */
    createdAt: number;
}

export interface AuthCodeContext {
    /** Bearer token received from GitHub's token endpoint. */
    githubAccessToken: string;
    /** Scopes GitHub granted (space-separated). */
    scope: string;
    /** Same PKCE challenge we stored at authorize time, verified on token exchange. */
    codeChallenge: string;
    /** Client redirect_uri — verified against the one sent on token exchange. */
    clientRedirectUri: string;
    /** Epoch ms. */
    createdAt: number;
}

export class StateStore<T extends { createdAt: number }> {
    private readonly entries = new Map<string, T>();

    constructor(private readonly ttlMs: number) {}

    set(key: string, value: T): void {
        this.sweep();
        this.entries.set(key, value);
    }

    /**
     * Single-use: returns the entry and removes it in one step. Callers
     * must not retry after consuming — both state keys and auth codes are
     * specified as single-use.
     */
    take(key: string): T | null {
        this.sweep();
        const entry = this.entries.get(key);
        if (!entry) return null;
        this.entries.delete(key);
        if (Date.now() - entry.createdAt > this.ttlMs) {
            return null;
        }
        return entry;
    }

    /** Exposed for tests and potential admin endpoints. */
    size(): number {
        this.sweep();
        return this.entries.size;
    }

    private sweep(): void {
        const cutoff = Date.now() - this.ttlMs;
        for (const [key, entry] of this.entries) {
            if (entry.createdAt < cutoff) {
                this.entries.delete(key);
            }
        }
    }
}

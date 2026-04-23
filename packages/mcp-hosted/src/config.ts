import { z } from 'zod';

/**
 * Runtime config for the hosted GHP MCP server.
 *
 * All fields come from process.env. This module is the single source of
 * truth — every other module should accept a resolved HostedConfig rather
 * than reading process.env directly, so tests can inject fake configs.
 */
const configSchema = z
    .object({
        /**
         * Port to bind the HTTP server. Railway / Fly inject this.
         * Default 8731 — chosen to avoid collisions with common local
         * services (Node 3000, Vite 5173, Rails/http-server 8080). When
         * fronted by Tailscale Funnel the public port is 443/8443/10000
         * regardless of the local choice.
         */
        port: z.coerce.number().int().positive().default(8731),

        /**
         * Mode guard. Must be exactly 'hosted' — any other value refuses to
         * start. Prevents the hosted bin from being accidentally launched on
         * a developer machine where it would expose network endpoints.
         */
        mode: z.literal('hosted'),

        /**
         * Public HTTPS base URL of this server. Used in OAuth metadata and
         * callback redirects. Required in production; optional in dev.
         */
        baseUrl: z.string().url().optional(),

        /**
         * Lock every session to a single GitHub repo. REQUIRED — without
         * it, RepoContext would attempt to auto-detect by running
         * `git remote get-url origin` in the server's cwd, which is
         * meaningless and spawns a subprocess in a multi-tenant hosted
         * deployment. Format: "owner/name".
         */
        lockedRepo: z
            .string()
            .regex(/^[^/]+\/[^/]+$/, 'GHP_REPO is required and must be owner/name'),

        /** Comma-separated CORS origin allowlist. '*' for dev. */
        allowedOrigins: z.string().default('*'),

        /**
         * GitHub OAuth App credentials. Required. The hosted server
         * mediates PKCE between the MCP client and GitHub (which does
         * not natively support PKCE on OAuth Apps), so the client_id
         * and client_secret live here, NEVER on the MCP client.
         */
        githubOauthClientId: z.string().min(1, 'GHP_GITHUB_OAUTH_CLIENT_ID is required'),
        githubOauthClientSecret: z
            .string()
            .min(1, 'GHP_GITHUB_OAUTH_CLIENT_SECRET is required'),

        /**
         * Comma-separated allowlist of redirect_uris MCP clients may
         * use. Exact match. Required — refusing to accept an unknown
         * redirect target is the primary defence against authorization
         * code phishing.
         */
        allowedRedirectUris: z
            .string()
            .min(1, 'GHP_ALLOWED_REDIRECT_URIS is required (comma-separated list)'),

        /** TTL (seconds) for ephemeral authorize state + auth codes. */
        oauthStateTtlSeconds: z.coerce.number().int().positive().default(600),

        nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
    })
    .refine(
        (c) => c.nodeEnv !== 'production' || (c.baseUrl !== undefined && c.baseUrl.startsWith('https://')),
        {
            message:
                'GHP_HOSTED_BASE_URL is required in production and must start with https://',
            path: ['baseUrl'],
        }
    );

export type HostedConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HostedConfig {
    return configSchema.parse({
        port: env.PORT,
        mode: env.GHP_MCP_MODE,
        baseUrl: env.GHP_HOSTED_BASE_URL,
        lockedRepo: env.GHP_REPO,
        allowedOrigins: env.GHP_ALLOWED_ORIGINS,
        githubOauthClientId: env.GHP_GITHUB_OAUTH_CLIENT_ID,
        githubOauthClientSecret: env.GHP_GITHUB_OAUTH_CLIENT_SECRET,
        allowedRedirectUris: env.GHP_ALLOWED_REDIRECT_URIS,
        oauthStateTtlSeconds: env.GHP_OAUTH_STATE_TTL_SECONDS,
        nodeEnv: env.NODE_ENV,
    });
}

export function parseAllowedRedirectUris(raw: string): string[] {
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

export function parseRepoInfo(lockedRepo: string): {
    owner: string;
    name: string;
    fullName: string;
} {
    const [owner, ...rest] = lockedRepo.split('/');
    const name = rest.join('/');
    return { owner, name, fullName: `${owner}/${name}` };
}

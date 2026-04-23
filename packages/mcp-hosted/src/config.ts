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
        /** Port to bind the HTTP server. Railway / Fly inject this. */
        port: z.coerce.number().int().positive().default(3000),

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
         * Lock every session to a single GitHub repo. When set, every
         * McpServer instance is created with this repo in RepoContext,
         * skipping git remote detection (which wouldn't work server-side
         * anyway). Format: "owner/name".
         */
        lockedRepo: z
            .string()
            .regex(/^[^/]+\/[^/]+$/, 'GHP_REPO must be owner/name')
            .optional(),

        /** Comma-separated CORS origin allowlist. '*' for dev. */
        allowedOrigins: z.string().default('*'),

        /** pino log level */
        logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

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
        logLevel: env.GHP_LOG_LEVEL,
        nodeEnv: env.NODE_ENV,
    });
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

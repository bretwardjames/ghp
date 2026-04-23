import type { ToolMeta } from '@bretwardjames/ghp-mcp';

/**
 * Belt-and-suspenders runtime assertion: refuse to run any tool that
 * declares `capability: 'local-only'` on a hosted server.
 *
 * The primary defense is filtering at registration time
 * (`pureApiTools` in @bretwardjames/ghp-mcp). This helper exists as a
 * defence-in-depth check for codepaths that might bypass the registry —
 * e.g. a future refactor that accidentally imports a tool directly.
 *
 * Throws so the failure is loud in logs, not silent.
 */
export function assertHostedSafe(meta: Pick<ToolMeta, 'name' | 'capability'>): void {
    if (meta.capability !== 'pure-api') {
        throw new Error(
            `Tool '${meta.name}' has capability '${meta.capability}' and cannot run on a hosted server. ` +
                `Only 'pure-api' tools may be registered. This is a programmer error — ` +
                `filter tools via pureApiTools before registering.`
        );
    }
}

/**
 * Assert the process was launched in hosted mode. Called at bin startup.
 * Config schema already enforces this (mode: z.literal('hosted')), but
 * this provides a clearer error message if the hosted runtime is ever
 * imported and misused programmatically.
 */
export function assertHostedMode(): void {
    if (process.env.GHP_MCP_MODE !== 'hosted') {
        throw new Error(
            `ghp-mcp-hosted requires GHP_MCP_MODE=hosted. ` +
                `Current value: '${process.env.GHP_MCP_MODE ?? '<unset>'}'. ` +
                `Refusing to start — this guard prevents the hosted HTTP surface ` +
                `from being launched in a local dev context by accident.`
        );
    }
}

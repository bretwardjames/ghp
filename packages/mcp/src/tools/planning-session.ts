import { planning } from '@bretwardjames/ghp-core';

/**
 * Process-wide planning session store.
 *
 * Stdio: one MCP process = one user, `ownerKey: 'default'` is fine.
 * Hosted: each request creates a fresh McpServer, but imports share
 * the same Node process → this singleton persists across requests in
 * one container. Hosted must set `ownerKey` from a per-user signal
 * (bearer token hash, userId, etc.) so tenants don't clobber each
 * other. That wiring is a follow-up; today hosted would coalesce all
 * users onto 'default' which is only safe for single-user deploys.
 */
const planningStore = new planning.PlanningSessionStore();

export function getPlanningStore(): planning.PlanningSessionStore {
    return planningStore;
}

/**
 * Derive an owner key for the session. Stdio uses a fixed literal;
 * hosted will override by reading from the request's bearer context.
 */
export function ownerKeyForProcess(): string {
    return process.env.GHP_PLANNING_OWNER_KEY ?? 'default';
}

export function newSessionId(): string {
    // 16 bytes of crypto-random, base64url-encoded. Collision-resistant
    // enough for the ~2h session lifetime without bringing in uuid.
    const { randomBytes } = require('crypto') as typeof import('crypto');
    return randomBytes(16)
        .toString('base64')
        .replace(/=+$/, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

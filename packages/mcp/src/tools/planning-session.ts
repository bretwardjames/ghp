import { planning } from '@bretwardjames/ghp-core';
import type { RepoInfo } from '@bretwardjames/ghp-core';
import { randomBytes } from 'crypto';
import type { ServerContext } from '../server.js';

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
    return randomBytes(16)
        .toString('base64')
        .replace(/=+$/, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

/**
 * Populate an active item's `body` in-place by fetching from GitHub.
 * Called each time a new item becomes active (planning_start's first
 * pop + every planning_next / planning_decide / planning_park
 * advance) so the LLM has the full description, not just the title.
 *
 * Body is cached on the item after first fetch within a session to
 * avoid a re-fetch if the same item is parked and returns later.
 */
export async function hydrateActiveItemBody(
    context: ServerContext,
    repo: RepoInfo,
    item: planning.PlanningItem | null
): Promise<planning.PlanningItem | null> {
    if (!item) return null;
    if (typeof item.body === 'string') return item; // already fetched
    try {
        const details = await context.api.getIssueDetails(repo, item.number);
        item.body = details?.body ?? '';
    } catch {
        // Non-fatal — LLM can still operate on title + fields.
        item.body = '';
    }
    return item;
}

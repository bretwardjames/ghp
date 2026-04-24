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
 * The fetch targets the item's OWN repo (parsed from `item.repository`),
 * not the session's default repo — GitHub Projects can aggregate items
 * from multiple repos and hydration must follow the actual source.
 *
 * Body is cached on the item after first fetch within a session to
 * avoid a re-fetch if the same item is parked and returns later.
 */
export async function hydrateActiveItemBody(
    context: ServerContext,
    item: planning.PlanningItem | null
): Promise<planning.PlanningItem | null> {
    if (!item) return null;
    if (typeof item.body === 'string') return item; // already fetched
    const itemRepo = parseItemRepository(item.repository);
    if (!itemRepo) {
        item.body = '(no repo attached to project item — likely a draft issue)';
        return item;
    }
    try {
        // Lean body-only fetch. Distinct from getIssueDetails (which
        // also pulls comments/labels/author/etc.) so one failing
        // sub-field doesn't take out the whole response.
        const body = await context.api.getIssueBody(itemRepo, item.number);
        if (body === null) {
            item.body = `(issue ${itemRepo.fullName}#${item.number} not found — may have been deleted or moved)`;
        } else {
            item.body = body;
        }
    } catch (err) {
        // Surface the error in the body field so the LLM (and the
        // operator looking at logs) can see WHY hydration failed,
        // instead of seeing a mysterious empty string.
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
            JSON.stringify({
                level: 'warn',
                msg: 'planning_hydrate_body_failed',
                repo: itemRepo.fullName,
                issue: item.number,
                error: msg,
            })
        );
        item.body = `(failed to fetch body: ${msg})`;
    }
    return item;
}

function parseItemRepository(repoString: string | null): RepoInfo | null {
    if (!repoString || !repoString.includes('/')) return null;
    const [owner, ...rest] = repoString.split('/');
    const name = rest.join('/');
    if (!owner || !name) return null;
    return { owner, name, fullName: `${owner}/${name}` };
}

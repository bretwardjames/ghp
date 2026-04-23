import type { PlanningSession } from './types.js';

/**
 * Process-local TTL store for planning sessions. Keyed by an
 * `ownerKey` — for stdio this is the process identity (effectively a
 * single user), for hosted deployments it will be a userId + repo
 * tuple so two runtight tenants can run concurrent meetings without
 * stepping on each other.
 *
 * Deliberately tiny. A Redis-backed replacement only needs to match
 * the same four methods.
 */
export class PlanningSessionStore {
    private readonly byId = new Map<string, PlanningSession>();
    private readonly activeByOwner = new Map<string, string>();

    constructor(private readonly ttlMs: number = 2 * 60 * 60 * 1000) {}

    start(session: PlanningSession): void {
        this.sweep();
        // A user starting a new meeting implicitly ends the previous one —
        // that's the expected product behaviour ("I'm starting over").
        const previousId = this.activeByOwner.get(session.ownerKey);
        if (previousId) this.byId.delete(previousId);
        this.byId.set(session.id, session);
        this.activeByOwner.set(session.ownerKey, session.id);
    }

    get(sessionId: string): PlanningSession | null {
        this.sweep();
        return this.byId.get(sessionId) ?? null;
    }

    getActiveForOwner(ownerKey: string): PlanningSession | null {
        this.sweep();
        const id = this.activeByOwner.get(ownerKey);
        if (!id) return null;
        return this.byId.get(id) ?? null;
    }

    update(session: PlanningSession): void {
        if (!this.byId.has(session.id)) return;
        this.byId.set(session.id, session);
    }

    end(sessionId: string): PlanningSession | null {
        this.sweep();
        const session = this.byId.get(sessionId);
        if (!session) return null;
        this.byId.delete(sessionId);
        if (this.activeByOwner.get(session.ownerKey) === sessionId) {
            this.activeByOwner.delete(session.ownerKey);
        }
        return session;
    }

    size(): number {
        this.sweep();
        return this.byId.size;
    }

    private sweep(): void {
        const cutoff = Date.now() - this.ttlMs;
        for (const [id, session] of this.byId) {
            if (session.startedAt < cutoff) {
                this.byId.delete(id);
                if (this.activeByOwner.get(session.ownerKey) === id) {
                    this.activeByOwner.delete(session.ownerKey);
                }
            }
        }
    }
}

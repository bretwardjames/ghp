/**
 * Priority + staleness helpers for the queue builder.
 *
 * Pure functions, fixture-driven. Tests live in ranking.test.ts and
 * drive every branch without touching GraphQL.
 */

/**
 * Priority labels the flow doc defines: Low / Med / High / Urgent.
 * We accept any casing plus the common alias "Medium".
 */
export type PriorityTier = 'urgent' | 'high' | 'med' | 'low' | 'unset';

const PRIORITY_RANK: Record<PriorityTier, number> = {
    urgent: 4,
    high: 3,
    med: 2,
    low: 1,
    unset: 0,
};

export function parsePriority(raw: string | null | undefined): PriorityTier {
    if (!raw) return 'unset';
    const v = raw.trim().toLowerCase();
    if (v === 'urgent') return 'urgent';
    if (v === 'high') return 'high';
    if (v === 'medium' || v === 'med') return 'med';
    if (v === 'low') return 'low';
    return 'unset';
}

export function priorityRank(p: PriorityTier): number {
    return PRIORITY_RANK[p];
}

/**
 * Days since the item was last reviewed. Returns null when the item
 * has never been reviewed — those are the highest-signal items for the
 * planning meeting and get special-cased in the queue builder.
 */
export function daysSince(
    lastReviewed: string | null,
    now: Date = new Date()
): number | null {
    if (!lastReviewed) return null;
    const then = Date.parse(lastReviewed);
    if (Number.isNaN(then)) return null;
    const diffMs = now.getTime() - then;
    return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * Rolling-window freshness filter. Items reviewed within the last
 * `minDays` are EXCLUDED from the queue so the same item doesn't
 * resurface week over week. Never-reviewed items always pass.
 */
export function isFreshEnoughToSurface(
    lastReviewed: string | null,
    minDaysSinceLastReview: number,
    now: Date = new Date()
): boolean {
    const age = daysSince(lastReviewed, now);
    if (age === null) return true; // never reviewed
    return age >= minDaysSinceLastReview;
}

/**
 * Two-key sort comparator:
 *   1. Staleness (oldest first; never-reviewed = +Infinity stale)
 *   2. Priority (Urgent > High > Med > Low > unset)
 *
 * Returns negative when a should come first. Stable-by-default — same-
 * staleness-same-priority ties fall back to issue number asc so
 * identical configurations always sort the same way.
 */
export function compareStalenessAndPriority(
    a: {
        lastReviewed: string | null;
        priority: PriorityTier;
        number: number;
    },
    b: {
        lastReviewed: string | null;
        priority: PriorityTier;
        number: number;
    },
    now: Date = new Date()
): number {
    const aAge = daysSince(a.lastReviewed, now);
    const bAge = daysSince(b.lastReviewed, now);
    const aStale = aAge === null ? Number.POSITIVE_INFINITY : aAge;
    const bStale = bAge === null ? Number.POSITIVE_INFINITY : bAge;
    if (aStale !== bStale) return bStale - aStale; // older first
    const prDelta = priorityRank(b.priority) - priorityRank(a.priority);
    if (prDelta !== 0) return prDelta;
    return a.number - b.number; // deterministic tiebreak
}

import type { PlanningBucket, PlanningItem, MeetingType } from './types.js';
import { parsePriority, isFreshEnoughToSurface, compareStalenessAndPriority } from './ranking.js';

/**
 * Minimal shape of a project item the queue builder consumes. Mirrors
 * the subset of `ProjectItem` (from core/types.ts) we need, plus one
 * derived field (`iterationTitle`) the caller resolves from the
 * project's iteration field. Kept as a local interface so the queue
 * builder is trivially testable with literals.
 */
export interface QueueInputItem {
    number: number;
    title: string;
    url: string | null;
    status: string | null;
    priority: string | null;
    size: string | null;
    assignees: string[];
    /** ISO date from the Last Reviewed field, or sentinel, or null. */
    lastReviewed: string | null;
    iterationTitle: string | null;
}

export interface QueueBuildInput {
    items: ReadonlyArray<QueueInputItem>;
    meetingType: MeetingType;
    currentSprintTitle: string | null;
    upcomingSprintTitles: ReadonlyArray<string>; // ordered: [next, next+1, ...]
    minDaysSinceLastReview: number;
    now?: Date;
}

/**
 * Compose a ranked planning queue from project items. The queue
 * preserves bucket order (the flow doc's meeting steps) and ranks
 * within each bucket by (staleness desc, priority desc).
 *
 * Fresh items (reviewed within `minDaysSinceLastReview`) are excluded
 * outright — per the flow-doc goal of not resurfacing the same ticket
 * week after week. Exception: items in the current sprint still need
 * assignment, so the current-sprint bucket doesn't apply the fresh-
 * ness filter.
 */
export function buildQueue(input: QueueBuildInput): PlanningItem[] {
    const now = input.now ?? new Date();
    const weekly = input.meetingType === 'weekly' || input.meetingType === 'milestone-boundary';

    const bucketed: Record<PlanningBucket, PlanningItem[]> = {
        'current-sprint-unassigned': [],
        'past-sprint-stuck': [],
        'untriaged-backlog': [],
        'resurfacing-backlog': [],
        'next-sprint': [],
        'next-plus-one-sprint': [],
        'unscheduled-kill-list': [],
        'ready-for-release': [],
        'milestone-open': [],
        'full-backlog': [],
    };

    for (const item of input.items) {
        const bucket = classifyBucket(item, input);
        if (!bucket) continue;
        // Freshness filter — the current-sprint bucket is exempt because
        // sprint assignment isn't the same as a review, and we'd lock
        // out sprint planning otherwise.
        if (bucket !== 'current-sprint-unassigned' && bucket !== 'past-sprint-stuck') {
            if (!isFreshEnoughToSurface(item.lastReviewed, input.minDaysSinceLastReview, now)) {
                continue;
            }
        }
        bucketed[bucket].push({
            number: item.number,
            title: item.title,
            url: item.url ?? '',
            priority: item.priority,
            size: item.size,
            lastReviewed: item.lastReviewed,
            assignees: item.assignees,
            bucket,
        });
    }

    // Rank within each bucket.
    for (const key of Object.keys(bucketed) as PlanningBucket[]) {
        bucketed[key].sort((a, b) =>
            compareStalenessAndPriority(
                {
                    number: a.number,
                    lastReviewed: a.lastReviewed,
                    priority: parsePriority(a.priority),
                },
                {
                    number: b.number,
                    lastReviewed: b.lastReviewed,
                    priority: parsePriority(b.priority),
                },
                now
            )
        );
    }

    // Concatenate buckets in the flow-doc meeting-step order.
    const weeklyOrder: PlanningBucket[] = [
        'current-sprint-unassigned',
        'past-sprint-stuck',
        'untriaged-backlog',
        'resurfacing-backlog',
        'next-sprint',
        'next-plus-one-sprint',
        'unscheduled-kill-list',
        'ready-for-release',
    ];
    const boundaryExtras: PlanningBucket[] = ['milestone-open', 'full-backlog'];
    const order = weekly
        ? input.meetingType === 'milestone-boundary'
            ? [...weeklyOrder, ...boundaryExtras]
            : weeklyOrder
        : weeklyOrder;

    return order.flatMap((b) => bucketed[b]);
}

function classifyBucket(
    item: QueueInputItem,
    input: QueueBuildInput
): PlanningBucket | null {
    const status = (item.status ?? '').toLowerCase();

    // Step 4 — sprint assignment
    if (item.iterationTitle === input.currentSprintTitle) {
        if (item.assignees.length === 0 && status === 'kill list') {
            return 'current-sprint-unassigned';
        }
        return null; // current sprint, already assigned → not surfaced
    }
    if (
        item.iterationTitle &&
        input.currentSprintTitle &&
        item.iterationTitle !== input.currentSprintTitle &&
        !input.upcomingSprintTitles.includes(item.iterationTitle) &&
        status === 'kill list'
    ) {
        return 'past-sprint-stuck';
    }

    // Step 5 — triage + backlog resurface
    if (status === 'backlog') {
        if (!item.lastReviewed) return 'untriaged-backlog';
        return 'resurfacing-backlog';
    }

    // Step 6 — forward planning
    if (status === 'kill list') {
        if (item.iterationTitle === input.upcomingSprintTitles[0]) {
            return 'next-sprint';
        }
        if (item.iterationTitle === input.upcomingSprintTitles[1]) {
            return 'next-plus-one-sprint';
        }
        if (!item.iterationTitle) {
            return 'unscheduled-kill-list';
        }
    }

    // Step 7 — release check
    if (status === 'ready for release') {
        return 'ready-for-release';
    }

    // Milestone-boundary extras are bucketed separately by the caller
    // passing the right meetingType; for now they share the backlog
    // buckets (the full-backlog pass is additive, not corrective).

    return null;
}

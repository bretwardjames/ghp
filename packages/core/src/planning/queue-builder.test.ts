import { describe, it, expect } from 'vitest';
import { buildQueue, type QueueInputItem } from './queue-builder.js';

const NOW = new Date('2026-04-22T00:00:00Z');

function item(overrides: Partial<QueueInputItem>): QueueInputItem {
    return {
        number: 1,
        title: 'Test issue',
        url: 'https://example.com/1',
        status: 'Backlog',
        priority: null,
        size: null,
        assignees: [],
        lastReviewed: null,
        iterationTitle: null,
        ...overrides,
    };
}

describe('buildQueue — weekly', () => {
    const base = {
        meetingType: 'weekly' as const,
        currentSprintTitle: 'Sprint 42',
        upcomingSprintTitles: ['Sprint 43', 'Sprint 44'] as const,
        minDaysSinceLastReview: 7,
        now: NOW,
    };

    it('surfaces untriaged backlog + unscheduled kill list in meeting-step order', () => {
        const queue = buildQueue({
            ...base,
            items: [
                item({ number: 1, status: 'Backlog', lastReviewed: null }),
                item({ number: 2, status: 'Kill List', iterationTitle: null }),
                item({
                    number: 3,
                    status: 'Kill List',
                    iterationTitle: 'Sprint 42',
                    assignees: [],
                }),
            ],
        });
        // current-sprint-unassigned (#3) must come first (step 4 before step 5)
        expect(queue.map((q) => q.number)).toEqual([3, 1, 2]);
        expect(queue.map((q) => q.bucket)).toEqual([
            'current-sprint-unassigned',
            'untriaged-backlog',
            'unscheduled-kill-list',
        ]);
    });

    it('excludes items reviewed within the freshness window (don\'t resurface weekly)', () => {
        const queue = buildQueue({
            ...base,
            items: [
                item({ number: 1, status: 'Backlog', lastReviewed: '2026-04-21' }), // 1d ago
                item({ number: 2, status: 'Backlog', lastReviewed: '2026-04-10' }), // 12d ago
            ],
        });
        expect(queue.map((q) => q.number)).toEqual([2]);
    });

    it('within a bucket, ranks by staleness desc then priority desc', () => {
        const queue = buildQueue({
            ...base,
            items: [
                item({ number: 1, status: 'Backlog', lastReviewed: '2026-04-08', priority: 'Low' }),
                item({ number: 2, status: 'Backlog', lastReviewed: '2026-03-20', priority: 'Low' }),
                item({ number: 3, status: 'Backlog', lastReviewed: '2026-03-20', priority: 'High' }),
            ],
        });
        // #2 + #3 are tied on staleness (older than #1). Priority breaks tie.
        // Overall order: [3 (older + high), 2 (older + low), 1 (newer + low)]
        expect(queue.map((q) => q.number)).toEqual([3, 2, 1]);
    });

    it('current-sprint-unassigned skips the freshness filter', () => {
        const queue = buildQueue({
            ...base,
            items: [
                item({
                    number: 1,
                    status: 'Kill List',
                    iterationTitle: 'Sprint 42',
                    assignees: [],
                    lastReviewed: '2026-04-21', // 1d ago — fresh
                }),
            ],
        });
        // Freshness filter shouldn't apply to sprint-assignment bucket.
        expect(queue.map((q) => q.number)).toEqual([1]);
    });

    it('items in the current sprint with an assignee are NOT surfaced', () => {
        const queue = buildQueue({
            ...base,
            items: [
                item({
                    number: 1,
                    status: 'Kill List',
                    iterationTitle: 'Sprint 42',
                    assignees: ['bret'],
                }),
            ],
        });
        expect(queue).toEqual([]);
    });

    it('past-sprint-stuck: kill-list items in an old iteration get flagged', () => {
        const queue = buildQueue({
            ...base,
            items: [
                item({
                    number: 1,
                    status: 'Kill List',
                    iterationTitle: 'Sprint 39', // neither current nor upcoming
                }),
            ],
        });
        expect(queue[0]?.bucket).toBe('past-sprint-stuck');
    });

    it('forward-planning buckets split next vs next+1', () => {
        const queue = buildQueue({
            ...base,
            items: [
                item({ number: 1, status: 'Kill List', iterationTitle: 'Sprint 43' }),
                item({ number: 2, status: 'Kill List', iterationTitle: 'Sprint 44' }),
            ],
        });
        const byNum = Object.fromEntries(queue.map((q) => [q.number, q.bucket]));
        expect(byNum[1]).toBe('next-sprint');
        expect(byNum[2]).toBe('next-plus-one-sprint');
    });

    it('ready-for-release items surface last', () => {
        const queue = buildQueue({
            ...base,
            items: [
                item({ number: 1, status: 'Backlog', lastReviewed: null }),
                item({ number: 2, status: 'Ready for Release', lastReviewed: null }),
            ],
        });
        expect(queue.map((q) => q.number)).toEqual([1, 2]);
    });

    it('items with no matching bucket are dropped', () => {
        const queue = buildQueue({
            ...base,
            items: [
                item({ number: 1, status: 'In Progress' }),
                item({ number: 2, status: 'Done' }),
            ],
        });
        expect(queue).toEqual([]);
    });

    it('projects without iterations still surface backlog items', () => {
        // Regression: when currentSprintTitle is null, a `null === null`
        // match in the sprint-assignment branch used to drop every
        // item. Backlog items should still flow through.
        const queue = buildQueue({
            ...base,
            currentSprintTitle: null,
            upcomingSprintTitles: [],
            items: [
                item({ number: 1, status: 'Backlog', lastReviewed: null }),
                item({ number: 2, status: 'Todo' }),
            ],
        });
        expect(queue.map((q) => q.number).sort()).toEqual([1, 2]);
    });

    it('aliases common status names to the flow-doc buckets', () => {
        // Todo / To Do / Committed all map to kill-list per STATUS_ALIASES.
        const queue = buildQueue({
            ...base,
            currentSprintTitle: null,
            upcomingSprintTitles: [],
            items: [
                item({ number: 1, status: 'Todo' }),
                item({ number: 2, status: 'To Do' }),
                item({ number: 3, status: 'Committed' }),
                item({ number: 4, status: 'Ready' }),
            ],
        });
        const buckets = Object.fromEntries(queue.map((q) => [q.number, q.bucket]));
        expect(buckets[1]).toBe('unscheduled-kill-list');
        expect(buckets[2]).toBe('unscheduled-kill-list');
        expect(buckets[3]).toBe('unscheduled-kill-list');
        expect(buckets[4]).toBe('ready-for-release');
    });
});

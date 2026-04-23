import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlanningSessionStore } from './session-store.js';
import type { PlanningSession } from './types.js';

function fixture(
    overrides: Partial<PlanningSession> = {}
): PlanningSession {
    return {
        id: 's1',
        startedAt: Date.now(),
        ownerKey: 'bret@localhost',
        meetingType: 'weekly',
        maxMinutesPerTicket: 3,
        minDaysSinceLastReview: 7,
        capability: {
            projectTitle: 'Test',
            projectId: 'P_1',
            detected: {
                Status: true,
                Priority: true,
                Size: false,
                'Last Reviewed': false,
                Sprint: false,
            },
            fallbacks: [],
            suggestions: [],
        },
        queue: [],
        decisions: {},
        parked: [],
        activeItem: null,
        activeItemSince: null,
        ...overrides,
    };
}

describe('PlanningSessionStore', () => {
    let store: PlanningSessionStore;
    beforeEach(() => {
        vi.useFakeTimers();
        store = new PlanningSessionStore(60_000);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('starts and retrieves a session', () => {
        store.start(fixture());
        expect(store.get('s1')?.id).toBe('s1');
        expect(store.getActiveForOwner('bret@localhost')?.id).toBe('s1');
    });

    it('starting a new session for the same owner replaces the previous one', () => {
        store.start(fixture({ id: 's1' }));
        store.start(fixture({ id: 's2' }));
        expect(store.get('s1')).toBeNull();
        expect(store.get('s2')?.id).toBe('s2');
        expect(store.getActiveForOwner('bret@localhost')?.id).toBe('s2');
    });

    it('two owners can run concurrent sessions', () => {
        store.start(fixture({ id: 's1', ownerKey: 'bret@a' }));
        store.start(fixture({ id: 's2', ownerKey: 'alex@b' }));
        expect(store.getActiveForOwner('bret@a')?.id).toBe('s1');
        expect(store.getActiveForOwner('alex@b')?.id).toBe('s2');
    });

    it('end removes the session and clears the active pointer', () => {
        store.start(fixture());
        store.end('s1');
        expect(store.get('s1')).toBeNull();
        expect(store.getActiveForOwner('bret@localhost')).toBeNull();
    });

    it('sessions older than ttlMs are swept on access', () => {
        store.start(fixture());
        vi.advanceTimersByTime(60_001);
        expect(store.get('s1')).toBeNull();
        expect(store.getActiveForOwner('bret@localhost')).toBeNull();
    });

    it('update mutates an existing session without touching inactive ones', () => {
        store.start(fixture());
        const session = store.get('s1')!;
        session.activeItem = {
            number: 42,
            title: 'T',
            url: '',
            priority: null,
            size: null,
            lastReviewed: null,
            assignees: [],
            bucket: 'untriaged-backlog',
        };
        store.update(session);
        expect(store.get('s1')?.activeItem?.number).toBe(42);
    });

    it('update on unknown id is a no-op', () => {
        store.update(fixture({ id: 'never-registered' }));
        expect(store.get('never-registered')).toBeNull();
    });
});

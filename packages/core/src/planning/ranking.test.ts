import { describe, it, expect } from 'vitest';
import {
    compareStalenessAndPriority,
    daysSince,
    isFreshEnoughToSurface,
    parsePriority,
    priorityRank,
} from './ranking.js';

const NOW = new Date('2026-04-22T00:00:00Z');

describe('parsePriority', () => {
    it('accepts every flow-doc label + common aliases', () => {
        expect(parsePriority('Urgent')).toBe('urgent');
        expect(parsePriority('HIGH')).toBe('high');
        expect(parsePriority('med')).toBe('med');
        expect(parsePriority('Medium')).toBe('med');
        expect(parsePriority('low')).toBe('low');
    });
    it('falls back to unset for null / unknown', () => {
        expect(parsePriority(null)).toBe('unset');
        expect(parsePriority('')).toBe('unset');
        expect(parsePriority('P0')).toBe('unset');
    });
});

describe('priorityRank', () => {
    it('ranks urgent > high > med > low > unset', () => {
        expect(priorityRank('urgent')).toBeGreaterThan(priorityRank('high'));
        expect(priorityRank('high')).toBeGreaterThan(priorityRank('med'));
        expect(priorityRank('med')).toBeGreaterThan(priorityRank('low'));
        expect(priorityRank('low')).toBeGreaterThan(priorityRank('unset'));
    });
});

describe('daysSince', () => {
    it('returns null when never reviewed', () => {
        expect(daysSince(null, NOW)).toBeNull();
    });
    it('returns age in days (UTC)', () => {
        expect(daysSince('2026-04-15', NOW)).toBe(7);
        expect(daysSince('2026-04-22', NOW)).toBe(0);
    });
    it('returns null on unparseable input', () => {
        expect(daysSince('not-a-date', NOW)).toBeNull();
    });
});

describe('isFreshEnoughToSurface', () => {
    it('never-reviewed items always pass', () => {
        expect(isFreshEnoughToSurface(null, 7, NOW)).toBe(true);
    });
    it('excludes items reviewed within the threshold', () => {
        expect(isFreshEnoughToSurface('2026-04-20', 7, NOW)).toBe(false); // 2d ago
    });
    it('passes items older than the threshold', () => {
        expect(isFreshEnoughToSurface('2026-04-10', 7, NOW)).toBe(true); // 12d ago
    });
    it('boundary: exactly at threshold counts as fresh enough', () => {
        expect(isFreshEnoughToSurface('2026-04-15', 7, NOW)).toBe(true); // exactly 7d
    });
});

describe('compareStalenessAndPriority', () => {
    it('never-reviewed items come first regardless of priority', () => {
        const untriagedLow = {
            number: 1,
            lastReviewed: null,
            priority: 'low' as const,
        };
        const recentUrgent = {
            number: 2,
            lastReviewed: '2026-04-21',
            priority: 'urgent' as const,
        };
        expect(
            compareStalenessAndPriority(untriagedLow, recentUrgent, NOW)
        ).toBeLessThan(0);
    });

    it('within same staleness, higher priority wins', () => {
        const a = { number: 1, lastReviewed: '2026-04-10', priority: 'high' as const };
        const b = { number: 2, lastReviewed: '2026-04-10', priority: 'low' as const };
        expect(compareStalenessAndPriority(a, b, NOW)).toBeLessThan(0);
    });

    it('stalest-first: older lastReviewed comes first', () => {
        const older = {
            number: 1,
            lastReviewed: '2026-03-01',
            priority: 'low' as const,
        };
        const newer = {
            number: 2,
            lastReviewed: '2026-04-10',
            priority: 'low' as const,
        };
        expect(compareStalenessAndPriority(older, newer, NOW)).toBeLessThan(0);
    });

    it('ties break on issue number (deterministic)', () => {
        const a = {
            number: 10,
            lastReviewed: '2026-04-10',
            priority: 'high' as const,
        };
        const b = {
            number: 5,
            lastReviewed: '2026-04-10',
            priority: 'high' as const,
        };
        expect(compareStalenessAndPriority(a, b, NOW)).toBeGreaterThan(0);
        expect(compareStalenessAndPriority(b, a, NOW)).toBeLessThan(0);
    });
});

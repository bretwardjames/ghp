import { describe, it, expect } from 'vitest';
import {
    formatSentinel,
    parseSentinel,
    upsertSentinel,
    todayIsoDate,
} from './review-sentinel.js';

describe('formatSentinel', () => {
    it('emits the canonical comment shape', () => {
        expect(
            formatSentinel({
                reviewedOn: '2026-04-22',
                decision: 'backlog',
                by: 'bret',
            })
        ).toBe('<!-- ghp:reviewed:2026-04-22:backlog:bret -->');
    });
});

describe('parseSentinel', () => {
    it('roundtrips via formatSentinel', () => {
        const s = { reviewedOn: '2026-04-22', decision: 'kill-list', by: 'bret' };
        expect(parseSentinel(formatSentinel(s))).toEqual(s);
    });

    it('finds the sentinel inside a longer body', () => {
        const body = `## Context\n\nSomething.\n\n<!-- ghp:reviewed:2025-12-30:close:alice -->\n`;
        expect(parseSentinel(body)).toEqual({
            reviewedOn: '2025-12-30',
            decision: 'close',
            by: 'alice',
        });
    });

    it('returns null when no sentinel is present', () => {
        expect(parseSentinel('just a body, no sentinel')).toBeNull();
        expect(parseSentinel('')).toBeNull();
        expect(parseSentinel(null)).toBeNull();
        expect(parseSentinel(undefined)).toBeNull();
    });

    it('rejects malformed variants', () => {
        expect(parseSentinel('<!-- ghp:reviewed: -->')).toBeNull();
        expect(parseSentinel('<!-- ghp:reviewed:not-a-date:backlog:bret -->')).toBeNull();
    });
});

describe('upsertSentinel', () => {
    it('appends a sentinel to an empty body', () => {
        const out = upsertSentinel(null, {
            reviewedOn: '2026-04-22',
            decision: 'backlog',
            by: 'bret',
        });
        expect(out).toBe('<!-- ghp:reviewed:2026-04-22:backlog:bret -->');
    });

    it('appends to an existing body preserving content', () => {
        const out = upsertSentinel('## Context\n\nSome notes.', {
            reviewedOn: '2026-04-22',
            decision: 'backlog',
            by: 'bret',
        });
        expect(out).toBe(
            '## Context\n\nSome notes.\n\n<!-- ghp:reviewed:2026-04-22:backlog:bret -->'
        );
    });

    it('replaces an existing sentinel in-place', () => {
        const body = '## Context\n\n<!-- ghp:reviewed:2020-01-01:close:alice -->\n\nTail.';
        const out = upsertSentinel(body, {
            reviewedOn: '2026-04-22',
            decision: 'kill-list',
            by: 'bret',
        });
        expect(out).toBe(
            '## Context\n\n<!-- ghp:reviewed:2026-04-22:kill-list:bret -->\n\nTail.'
        );
        // Only one sentinel should remain.
        expect(out.match(/ghp:reviewed/g)?.length).toBe(1);
    });
});

describe('todayIsoDate', () => {
    it('emits YYYY-MM-DD', () => {
        expect(todayIsoDate(new Date('2026-04-22T18:30:00Z'))).toBe('2026-04-22');
    });

    it('uses UTC regardless of server TZ', () => {
        expect(todayIsoDate(new Date('2026-04-22T23:59:00Z'))).toBe('2026-04-22');
        expect(todayIsoDate(new Date('2026-04-23T00:01:00Z'))).toBe('2026-04-23');
    });
});

import { describe, it, expect } from 'vitest';
import { auditTimeline } from './timeline-audit.js';
import type { IterationInfo, MilestoneInfo } from './types.js';

const NOW = new Date('2026-04-22T00:00:00Z');

function it7(title: string, startDate: string): IterationInfo {
    return { id: `I_${title}`, title, startDate, duration: 7 };
}

function ms(
    number: number,
    title: string,
    dueOn: string | null,
    openIssueCount = 0,
    state: 'open' | 'closed' = 'open'
): MilestoneInfo {
    return { number, title, state, dueOn, openIssueCount };
}

describe('auditTimeline', () => {
    it('current + 2 upcoming + no stale milestones → no findings', () => {
        const report = auditTimeline({
            iterations: [
                it7('Sprint 42', '2026-04-20'),
                it7('Sprint 43', '2026-04-27'),
                it7('Sprint 44', '2026-05-04'),
            ],
            completedIterationCount: 41,
            milestones: [ms(1, 'V1', '2026-06-01', 5)],
            now: NOW,
        });
        expect(report.iterations.current?.title).toBe('Sprint 42');
        expect(report.iterations.upcoming.map((i) => i.title)).toEqual([
            'Sprint 43',
            'Sprint 44',
        ]);
        expect(report.findings).toEqual([]);
    });

    it('no iteration covers today → finding + create-iteration suggestion', () => {
        const report = auditTimeline({
            iterations: [it7('Sprint 10', '2025-12-01')], // completed
            completedIterationCount: 10,
            milestones: [],
            now: NOW,
        });
        const finding = report.findings.find((f) => f.kind === 'no-current-iteration');
        expect(finding).toBeTruthy();
        expect(finding?.suggestedAction.op).toBe('create-iteration');
    });

    it('rolling window short → create-iteration with continuing numbering', () => {
        const report = auditTimeline({
            iterations: [
                it7('Sprint 42', '2026-04-20'),
                it7('Sprint 43', '2026-04-27'),
                // only 1 upcoming; want 2
            ],
            completedIterationCount: 41,
            milestones: [],
            now: NOW,
            rollingWindowSize: 3,
        });
        const finding = report.findings.find((f) => f.kind === 'rolling-window-short');
        expect(finding).toBeTruthy();
        if (finding && finding.suggestedAction.op === 'create-iteration') {
            expect(finding.suggestedAction.title).toBe('Sprint 44');
            // Should start after Sprint 43 ends (2026-04-27 + 7d = 2026-05-04).
            expect(finding.suggestedAction.startDate).toBe('2026-05-04');
        } else {
            throw new Error('expected create-iteration action');
        }
    });

    it('past-due open milestone with open items → stale finding', () => {
        const report = auditTimeline({
            iterations: [it7('Sprint 42', '2026-04-20')],
            completedIterationCount: 0,
            milestones: [ms(3, 'V0.9', '2026-03-01', 4)],
            now: NOW,
        });
        const finding = report.findings.find((f) => f.kind === 'milestone-past-due');
        expect(finding?.severity).toBe('warn');
        expect(finding?.description).toContain('V0.9');
        expect(finding?.suggestedAction).toEqual({
            op: 'close-milestone',
            number: 3,
        });
        expect(report.milestones.stale.map((m) => m.number)).toEqual([3]);
    });

    it('past-due milestone with zero open items → NOT flagged', () => {
        const report = auditTimeline({
            iterations: [it7('Sprint 42', '2026-04-20')],
            completedIterationCount: 0,
            milestones: [ms(3, 'V0.9', '2026-03-01', 0)],
            now: NOW,
        });
        expect(
            report.findings.find((f) => f.kind === 'milestone-past-due')
        ).toBeUndefined();
    });

    it('no current milestone → info finding', () => {
        const report = auditTimeline({
            iterations: [it7('Sprint 42', '2026-04-20')],
            completedIterationCount: 0,
            milestones: [],
            now: NOW,
        });
        const finding = report.findings.find((f) => f.kind === 'no-current-milestone');
        expect(finding?.severity).toBe('info');
    });

    it('closed milestones are ignored', () => {
        const report = auditTimeline({
            iterations: [it7('Sprint 42', '2026-04-20')],
            completedIterationCount: 0,
            milestones: [ms(1, 'Old V', '2026-03-01', 5, 'closed')],
            now: NOW,
        });
        expect(report.milestones.stale).toEqual([]);
    });
});

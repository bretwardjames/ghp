import type {
    IterationInfo,
    MilestoneInfo,
    TimelineAudit,
    TimelineFinding,
} from './types.js';

/**
 * Audit the project's iteration + milestone timeline.
 *
 * Inputs are plain data (no GraphQL calls) so tests can drive every
 * branch without mocking Octokit. The caller gathers iteration metadata
 * from the Sprint field and milestone data from the repo.
 *
 * "Current" iteration/milestone: any whose window contains `today`.
 * "Upcoming": future start, sorted ascending.
 * "Completed"/"past": we only need the count for iterations and only
 * the stale list for milestones (past due AND still has open items).
 */
export interface TimelineInput {
    iterations: IterationInfo[]; // unfiltered
    completedIterationCount: number;
    milestones: MilestoneInfo[]; // only open ones need evaluation
    /** Desired rolling-window horizon; default 3 per the flow doc. */
    rollingWindowSize?: number;
    /** Default iteration width when suggesting creation (days). */
    defaultIterationDuration?: number;
    now?: Date;
}

export function auditTimeline(input: TimelineInput): TimelineAudit {
    const now = input.now ?? new Date();
    const horizon = input.rollingWindowSize ?? 3;
    const defaultDur = input.defaultIterationDuration ?? 7;

    const iterationBuckets = bucketIterations(input.iterations, now);
    const milestoneBuckets = bucketMilestones(input.milestones, now);

    const findings: TimelineFinding[] = [];

    if (!iterationBuckets.current) {
        findings.push({
            kind: 'no-current-iteration',
            severity: 'warn',
            description:
                'No iteration covers today. Step 4 of the weekly planning meeting (current sprint) has nothing to operate on.',
            suggestedAction: {
                op: 'create-iteration',
                title: suggestNextIterationTitle(input.iterations),
                startDate: toIsoDate(now),
                duration: defaultDur,
            },
        });
    }

    const upcomingCount = iterationBuckets.upcoming.length;
    if (upcomingCount < horizon - 1) {
        // The current iteration counts toward the window, so we need
        // `horizon - 1` upcoming iterations to plan 2-3 sprints ahead.
        const nextStart = nextIterationStart(
            iterationBuckets.current,
            iterationBuckets.upcoming,
            now,
            defaultDur
        );
        findings.push({
            kind: 'rolling-window-short',
            severity: 'info',
            description: `Rolling planning window needs ${horizon} iterations (current + ${horizon - 1} upcoming); project has ${
                upcomingCount
            } upcoming.`,
            suggestedAction: {
                op: 'create-iteration',
                title: suggestNextIterationTitle(input.iterations),
                startDate: toIsoDate(nextStart),
                duration: defaultDur,
            },
        });
    }

    if (!milestoneBuckets.current) {
        findings.push({
            kind: 'no-current-milestone',
            severity: 'info',
            description:
                'No open milestone is currently active. Milestones are optional per the flow doc, but a current one helps group committed work.',
            suggestedAction: { op: 'none' },
        });
    }

    for (const m of milestoneBuckets.stale) {
        findings.push({
            kind: 'milestone-past-due',
            severity: 'warn',
            description: `Milestone "${m.title}" is past its due date and still has ${m.openIssueCount} open item${
                m.openIssueCount === 1 ? '' : 's'
            }. Move outstanding items to the next milestone or close them out.`,
            suggestedAction: { op: 'close-milestone', number: m.number },
        });
    }

    return {
        iterations: {
            current: iterationBuckets.current,
            upcoming: iterationBuckets.upcoming,
            completed: input.completedIterationCount,
        },
        milestones: {
            current: milestoneBuckets.current,
            upcoming: milestoneBuckets.upcoming,
            stale: milestoneBuckets.stale,
        },
        findings,
    };
}

function bucketIterations(
    iterations: IterationInfo[],
    now: Date
): { current: IterationInfo | null; upcoming: IterationInfo[] } {
    let current: IterationInfo | null = null;
    const upcoming: IterationInfo[] = [];
    const nowMs = now.getTime();
    for (const it of iterations) {
        const start = Date.parse(it.startDate);
        const end = start + it.duration * 24 * 60 * 60 * 1000;
        if (Number.isNaN(start)) continue;
        if (start <= nowMs && nowMs < end) {
            current = it;
        } else if (start > nowMs) {
            upcoming.push(it);
        }
    }
    upcoming.sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate));
    return { current, upcoming };
}

function bucketMilestones(
    milestones: MilestoneInfo[],
    now: Date
): {
    current: MilestoneInfo | null;
    upcoming: MilestoneInfo[];
    stale: MilestoneInfo[];
} {
    const open = milestones.filter((m) => m.state === 'open');
    const nowMs = now.getTime();
    const current =
        open.find((m) => {
            if (!m.dueOn) return false;
            const due = Date.parse(m.dueOn);
            return !Number.isNaN(due) && due >= nowMs;
        }) ?? null;
    const upcoming = open
        .filter((m) => {
            if (!m.dueOn) return false;
            const due = Date.parse(m.dueOn);
            return !Number.isNaN(due) && due > nowMs && m !== current;
        })
        .sort((a, b) => Date.parse(a.dueOn!) - Date.parse(b.dueOn!));
    const stale = open.filter((m) => {
        if (!m.dueOn) return false;
        const due = Date.parse(m.dueOn);
        return !Number.isNaN(due) && due < nowMs && m.openIssueCount > 0;
    });
    return { current, upcoming, stale };
}

function suggestNextIterationTitle(existing: IterationInfo[]): string {
    // Try to continue an existing numbering scheme ("Sprint 42", "S42"),
    // otherwise fall back to a dated title so it's at least unique.
    const numbered = existing
        .map((i) => /(\d+)\s*$/.exec(i.title))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => Number(m[1]));
    if (numbered.length > 0) {
        const next = Math.max(...numbered) + 1;
        const sample = existing.find((i) => /\d+\s*$/.test(i.title))!;
        return sample.title.replace(/\d+\s*$/, String(next));
    }
    return `Sprint ${toIsoDate(new Date())}`;
}

function nextIterationStart(
    current: IterationInfo | null,
    upcoming: IterationInfo[],
    now: Date,
    defaultDur: number
): Date {
    const last = upcoming.at(-1) ?? current;
    if (!last) return now;
    const end =
        Date.parse(last.startDate) + last.duration * 24 * 60 * 60 * 1000;
    if (Number.isNaN(end)) return now;
    return new Date(end);
}

function toIsoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

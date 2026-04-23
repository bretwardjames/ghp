/**
 * Core types for the planning-meeting driver.
 *
 * The feature is built around a stateful meeting session: the MCP client
 * asks for the next item to discuss, the team makes a decision, the tool
 * records it (writing a review sentinel so the item doesn't resurface
 * next week), and the loop repeats until the queue is exhausted or the
 * meeting ends.
 *
 * Types live in core so both the stdio + hosted tool handlers import
 * from the same contract and tests can construct fixtures.
 */

/**
 * Project fields the planning flow would like to consume. Anything here
 * that the GitHub Project lacks is degraded via `FieldFallback`.
 */
export type PlanningFieldName =
    | 'Status'
    | 'Priority'
    | 'Size'
    | 'Last Reviewed'
    | 'Sprint';

/**
 * What the project actually exposes vs what we'd ideally use.
 * `true` = real project field; `'fallback'` = degraded path via labels,
 * comment sentinel, or milestone; `false` = unusable (rare — only
 * Status).
 */
export type FieldSupport = true | 'fallback' | false;

export interface FieldFallback {
    field: PlanningFieldName;
    /** How the tool substitutes when the real field is missing. */
    strategy:
        | 'project-field'
        | 'label-prefix'
        | 'body-sentinel'
        | 'milestone-group'
        | 'updated-at'
        | 'none';
    /** Human-readable explanation for the capability report. */
    description: string;
}

/**
 * What `probeProjectFields` returns — field-only view. The caller
 * combines this with a `TimelineAudit` to produce the full
 * `PlanningCapabilityReport` for consumers.
 */
export interface FieldProbeResult {
    projectTitle: string;
    projectId: string;
    detected: Record<PlanningFieldName, FieldSupport>;
    fallbacks: FieldFallback[];
    suggestions: Array<{
        field: PlanningFieldName;
        upgrade: string;
        impact: string;
    }>;
}

export interface PlanningCapabilityReport extends FieldProbeResult {
    /**
     * Findings about the project's iteration + milestone timeline.
     * Orthogonal to field presence: even a fully-configured project can
     * have a stale milestone or an empty rolling window.
     */
    timeline: TimelineAudit;
}

export interface TimelineAudit {
    iterations: {
        current: IterationInfo | null;
        upcoming: IterationInfo[]; // sorted by startDate asc
        completed: number; // count only — we don't need the list
    };
    milestones: {
        current: MilestoneInfo | null;
        upcoming: MilestoneInfo[];
        /** Past due date AND still has open items. */
        stale: MilestoneInfo[];
    };
    /**
     * Actionable issues with the timeline, surfaced with a suggested
     * `setup`-tool action so the LLM can offer it to the user.
     */
    findings: TimelineFinding[];
}

export interface IterationInfo {
    id: string;
    title: string;
    startDate: string; // ISO date
    /** Width of iteration in days. */
    duration: number;
}

export interface MilestoneInfo {
    number: number;
    title: string;
    state: 'open' | 'closed';
    dueOn: string | null; // ISO date
    openIssueCount: number;
}

export interface TimelineFinding {
    kind:
        | 'rolling-window-short'
        | 'no-current-iteration'
        | 'milestone-past-due'
        | 'no-current-milestone';
    severity: 'info' | 'warn';
    description: string;
    /** Machine-readable action the setup tool could take. */
    suggestedAction:
        | { op: 'create-iteration'; title: string; startDate: string; duration: number }
        | { op: 'create-milestone'; title: string; dueOn: string | null }
        | { op: 'close-milestone'; number: number }
        | { op: 'none' };
}

export type MeetingType = 'weekly' | 'milestone-boundary';

/**
 * Verdicts recorded via `planning.decide`. Kept small on purpose —
 * richer status changes (e.g. "move to sprint 3") belong on
 * dedicated tools the LLM can call separately.
 */
export type PlanningDecision =
    | 'kill-list'
    | 'backlog'
    | 'close'
    | 'bump'
    | 'assign'
    | 'no-change';

export interface PlanningItem {
    number: number;
    title: string;
    url: string;
    priority: string | null;
    size: string | null;
    /** ISO date or null if never reviewed. */
    lastReviewed: string | null;
    assignees: string[];
    /** Queue slot this item came from (used by tests + UI). */
    bucket: PlanningBucket;
}

export type PlanningBucket =
    | 'current-sprint-unassigned'
    | 'past-sprint-stuck'
    | 'untriaged-backlog'
    | 'resurfacing-backlog'
    | 'next-sprint'
    | 'next-plus-one-sprint'
    | 'unscheduled-kill-list'
    | 'ready-for-release'
    | 'milestone-open'
    | 'full-backlog';

export interface SessionInit {
    meetingType: MeetingType;
    /** Soft cap on wall-clock per item; `planning.status` flags breaches. */
    maxMinutesPerTicket: number;
    /** Optional: exclude items reviewed in the last N days. Default 7. */
    minDaysSinceLastReview: number;
}

export interface PlanningSession {
    id: string;
    startedAt: number; // epoch ms
    /** Used by hosted deployments to bind sessions to a user. */
    ownerKey: string;
    meetingType: MeetingType;
    maxMinutesPerTicket: number;
    minDaysSinceLastReview: number;
    capability: PlanningCapabilityReport;
    /** Ordered queue — highest-signal items first. */
    queue: PlanningItem[];
    /** Items already resolved this session, keyed by issue number. */
    decisions: Record<number, RecordedDecision>;
    /** Stack of items explicitly parked (returned to the bottom). */
    parked: number[];
    /** Currently-in-front-of-the-team item, for `planning.status` timing. */
    activeItem: PlanningItem | null;
    activeItemSince: number | null; // epoch ms
}

export interface RecordedDecision {
    decision: PlanningDecision;
    /** Free-text rationale recorded in the sentinel comment. */
    notes: string;
    decidedAt: number; // epoch ms
    /** Whether we successfully wrote the sentinel to the issue. */
    sentinelWritten: boolean;
}

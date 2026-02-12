/**
 * Standup formatting utilities.
 *
 * Provides shared formatting for standup activity summaries,
 * used by CLI, VS Code extension, and MCP tool.
 */

import type { IssueActivity, ActivityEvent } from './types.js';

/**
 * Options for formatting standup output
 */
export interface FormatStandupOptions {
    since: Date;
    colorize?: boolean;
    /** If true, show a flat chronological timeline instead of grouping by issue */
    timeline?: boolean;
}

/**
 * Format a standup summary as human-readable text.
 *
 * @param activities - Activity data from GitHubAPI.getRecentActivity()
 * @param options - Formatting options
 * @returns Formatted text string
 */
export function formatStandupText(
    activities: IssueActivity[],
    options: FormatStandupOptions,
): string {
    if (options.timeline) {
        return formatTimeline(activities, options);
    }
    return formatGrouped(activities, options);
}

/**
 * Format activities grouped by issue (default mode).
 */
function formatGrouped(
    activities: IssueActivity[],
    options: FormatStandupOptions,
): string {
    const { since } = options;
    const lines: string[] = [];

    // Header
    const sinceStr = formatRelativeDate(since);
    const issueCount = activities.length;
    lines.push(`Since ${sinceStr} — ${issueCount} issue${issueCount !== 1 ? 's' : ''} changed`);
    lines.push('');

    if (activities.length === 0) {
        lines.push('No activity found in this time window.');
        return lines.join('\n');
    }

    for (const activity of activities) {
        // Issue header
        const statusTag = activity.status ? ` [${activity.status}]` : '';
        lines.push(`#${activity.issue.number} ${activity.issue.title}${statusTag}`);

        // Group events by type for a concise summary
        for (const event of activity.changes) {
            lines.push(`  ${formatEventLine(event)}`);
        }

        lines.push('');
    }

    return lines.join('\n').trimEnd();
}

/**
 * Format activities as a flat chronological timeline.
 * Events are sorted newest-first with issue context on each line.
 */
function formatTimeline(
    activities: IssueActivity[],
    options: FormatStandupOptions,
): string {
    const { since } = options;
    const lines: string[] = [];

    // Flatten all events with their issue context
    const allEvents: { event: ActivityEvent; issue: IssueActivity['issue'] }[] = [];
    for (const activity of activities) {
        for (const event of activity.changes) {
            allEvents.push({ event, issue: activity.issue });
        }
    }

    // Sort newest-first
    allEvents.sort((a, b) =>
        new Date(b.event.timestamp).getTime() - new Date(a.event.timestamp).getTime()
    );

    // Header
    const sinceStr = formatRelativeDate(since);
    const eventCount = allEvents.length;
    const issueCount = activities.length;
    lines.push(`Since ${sinceStr} — ${eventCount} event${eventCount !== 1 ? 's' : ''} across ${issueCount} issue${issueCount !== 1 ? 's' : ''}`);
    lines.push('');

    if (allEvents.length === 0) {
        lines.push('No activity found in this time window.');
        return lines.join('\n');
    }

    for (const { event, issue } of allEvents) {
        const time = formatShortTimestamp(event.timestamp);
        const desc = formatEventDescription(event);
        const issueRef = `#${issue.number} ${truncate(issue.title, 50)}`;
        lines.push(`${time}  ${desc}  (${issueRef})`);
    }

    return lines.join('\n').trimEnd();
}

/**
 * Parse a duration string like "24h", "8h", "2d" or an ISO date into a Date.
 */
export function parseSince(input: string): Date {
    // Try ISO date first
    const isoDate = new Date(input);
    if (!isNaN(isoDate.getTime()) && input.includes('-')) {
        return isoDate;
    }

    // Parse duration format
    const match = input.match(/^(\d+)\s*(h|d|w)$/i);
    if (!match) {
        throw new Error(`Invalid duration format: "${input}". Use formats like "24h", "2d", "1w", or an ISO date.`);
    }

    const amount = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    const now = new Date();
    switch (unit) {
        case 'h':
            return new Date(now.getTime() - amount * 60 * 60 * 1000);
        case 'd':
            return new Date(now.getTime() - amount * 24 * 60 * 60 * 1000);
        case 'w':
            return new Date(now.getTime() - amount * 7 * 24 * 60 * 60 * 1000);
        default:
            throw new Error(`Unknown duration unit: "${unit}"`);
    }
}

/**
 * Format a single activity event as a display line.
 */
function formatEventLine(event: ActivityEvent): string {
    const arrow = '\u2197'; // ↗
    const timestamp = formatShortTimestamp(event.timestamp);
    const actor = event.actor;

    switch (event.type) {
        case 'comment':
            return `${arrow} Comment by ${actor} (${timestamp})${event.details ? ': ' + event.details : ''}`;
        case 'labeled':
            return `${arrow} Labeled "${event.details}" by ${actor} (${timestamp})`;
        case 'unlabeled':
            return `${arrow} Unlabeled "${event.details}" by ${actor} (${timestamp})`;
        case 'assigned':
            return `${arrow} Assigned to ${event.details || actor} (${timestamp})`;
        case 'unassigned':
            return `${arrow} Unassigned ${event.details || ''} by ${actor} (${timestamp})`;
        case 'closed':
            return `${arrow} Closed by ${actor} (${timestamp})`;
        case 'reopened':
            return `${arrow} Reopened by ${actor} (${timestamp})`;
        case 'referenced':
            return `${arrow} ${event.details} linked by ${actor} (${timestamp})`;
        case 'review_submitted':
            return `${arrow} ${event.details} by ${actor} (${timestamp})`;
        case 'review_requested':
            return `${arrow} Review requested from ${event.details || 'team'} by ${actor} (${timestamp})`;
        case 'pr_created':
            return `${arrow} PR created by ${actor} (${timestamp})`;
        case 'pr_merged':
            return `${arrow} PR merged by ${actor} (${timestamp})`;
        default:
            return `${arrow} ${event.type} by ${actor} (${timestamp})`;
    }
}

/**
 * Format a single event description without timestamp (for timeline mode).
 */
function formatEventDescription(event: ActivityEvent): string {
    const actor = event.actor;
    switch (event.type) {
        case 'comment':
            return `Comment by ${actor}${event.details ? ': ' + event.details : ''}`;
        case 'labeled':
            return `Labeled "${event.details}" by ${actor}`;
        case 'unlabeled':
            return `Unlabeled "${event.details}" by ${actor}`;
        case 'assigned':
            return `Assigned to ${event.details || actor}`;
        case 'unassigned':
            return `Unassigned ${event.details || ''} by ${actor}`;
        case 'closed':
            return `Closed by ${actor}`;
        case 'reopened':
            return `Reopened by ${actor}`;
        case 'referenced':
            return `${event.details} linked by ${actor}`;
        case 'review_submitted':
            return `${event.details} by ${actor}`;
        case 'review_requested':
            return `Review requested from ${event.details || 'team'} by ${actor}`;
        case 'pr_created':
            return `PR created by ${actor}`;
        case 'pr_merged':
            return `PR merged by ${actor}`;
        default:
            return `${event.type} by ${actor}`;
    }
}

/**
 * Truncate a string to a max length, adding ellipsis if needed.
 */
function truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 1) + '\u2026';
}

/**
 * Format a date as a relative description like "yesterday (Feb 10, 07:30)"
 */
function formatRelativeDate(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));

    const dateStr = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });

    if (diffHours < 24) {
        return `${diffHours}h ago (${dateStr})`;
    } else if (diffHours < 48) {
        return `yesterday (${dateStr})`;
    } else {
        const diffDays = Math.round(diffHours / 24);
        return `${diffDays} days ago (${dateStr})`;
    }
}

/**
 * Format a timestamp as a short display string like "Feb 10, 14:22"
 */
function formatShortTimestamp(isoTimestamp: string): string {
    if (!isoTimestamp) return '';
    const date = new Date(isoTimestamp);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

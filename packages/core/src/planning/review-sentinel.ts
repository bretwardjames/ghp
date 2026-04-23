/**
 * Sentinel that records a planning-meeting review on a GitHub issue.
 *
 * Written into the issue body as an HTML comment so it is invisible in
 * the GitHub UI but deterministically parseable. Preferred path is the
 * project-field `Last Reviewed` — the sentinel is the fallback used
 * when that field doesn't exist on a given project.
 *
 * Shape:
 *   <!-- ghp:reviewed:<yyyy-mm-dd>:<decision>:<by> -->
 *
 * Only one sentinel is kept per issue; older sentinels are overwritten
 * when a new decision is recorded, since "last reviewed" is by
 * definition a single value.
 */

// Actor handle group accepts the full GitHub username charset plus
// bracketed bot suffixes (e.g. `dependabot[bot]`). Excludes whitespace
// and the characters that would terminate the sentinel comment.
const SENTINEL_REGEX = /<!--\s*ghp:reviewed:(\d{4}-\d{2}-\d{2}):([a-z-]+):([A-Za-z0-9][A-Za-z0-9\-_.\[\]]*)\s*-->/i;

export interface ReviewSentinel {
    reviewedOn: string; // yyyy-mm-dd
    decision: string; // free-form; the caller supplies the value
    by: string; // actor handle, kept short (no spaces)
}

export function formatSentinel(s: ReviewSentinel): string {
    return `<!-- ghp:reviewed:${s.reviewedOn}:${s.decision}:${s.by} -->`;
}

export function parseSentinel(body: string | null | undefined): ReviewSentinel | null {
    if (!body) return null;
    const match = SENTINEL_REGEX.exec(body);
    if (!match) return null;
    return {
        reviewedOn: match[1],
        decision: match[2],
        by: match[3],
    };
}

/**
 * Return a new body with the sentinel appended (or replaced if one
 * already exists). Preserves trailing whitespace / user edits around
 * the sentinel.
 */
export function upsertSentinel(
    body: string | null | undefined,
    sentinel: ReviewSentinel
): string {
    const formatted = formatSentinel(sentinel);
    const existing = body ?? '';
    if (SENTINEL_REGEX.test(existing)) {
        return existing.replace(SENTINEL_REGEX, formatted);
    }
    if (existing.length === 0) {
        return formatted;
    }
    // Keep a blank line between body content and the sentinel so the
    // diff is readable when someone edits the issue in the GitHub UI.
    const trimmed = existing.replace(/\s+$/, '');
    return `${trimmed}\n\n${formatted}`;
}

/**
 * Convenience: ISO date in YYYY-MM-DD, UTC. Written into sentinels so
 * ordering is stable regardless of where the reviewer is located.
 */
export function todayIsoDate(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10);
}

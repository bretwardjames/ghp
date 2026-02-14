---
type: context
branch: bretwardjames/260-add-ghp-standup-command-for-daily-activity
issue: 260
status: active
created: '2026-02-11'
author: bretwardjames
---

## Issue

**#260**: Add `ghp standup` command for daily activity summary



## Description

## Summary

Add a `ghp standup` command that shows all issue activity since a given time (default: 24 hours ago). This gives a quick pre-standup summary of what changed across the project board without having to manually check each issue.

## Motivation

Before standups, you end up manually scanning the board to remember what moved, what got commented on, what was assigned, etc. This command would automate that into a single glanceable output.

## Proposed Implementation

### 1. Add `updatedAt` to `PROJECT_ITEMS_QUERY` (packages/core/src/queries.ts)

The existing `PROJECT_ITEMS_QUERY` sorts by `UPDATED_AT` but doesn't include it in the response fields. Add `updatedAt` to the issue/PR content fragments so we can filter client-side.

### 2. Add `timelineItems` query (packages/core/src/queries.ts)

New query to fetch timeline events for a specific issue. GitHub's `timelineItems` connection provides:
- `IssueComment` — new comments
- `LabeledEvent` / `UnlabeledEvent` — label changes
- `AssignedEvent` / `UnassignedEvent` — assignment changes
- `ClosedEvent` / `ReopenedEvent` — state changes
- `CrossReferencedEvent` — PR links, mentions
- `MovedColumnsInProjectEvent` — project board status changes
- `ReferencedEvent` — commit references

Filter with `since: DateTime` parameter to only get events in the time window.

### 3. New core API method (packages/core/src/github-api.ts)

```typescript
async getRecentActivity(repo: RepoInfo, since: Date): Promise<IssueActivity[]>
```

**Two-pass approach to minimize API usage (important given rate limits):**

1. **Pass 1:** Fetch all project items with `updatedAt`. Filter client-side to only items where `updatedAt > since`. This is a single paginated query we already make.
2. **Pass 2:** For each item that changed, fetch `timelineItems(since: $since)` to get the specific changes. Only hits the API for issues that actually changed.

This avoids fetching timelines for every issue on the board.

### 4. New types (packages/core/src/types.ts)

```typescript
interface IssueActivity {
  issue: { number: number; title: string; url: string };
  changes: ActivityEvent[];
}

interface ActivityEvent {
  type: 'comment' | 'status_change' | 'assigned' | 'unassigned' | 'labeled' | 'unlabeled' | 'closed' | 'reopened' | 'referenced';
  actor: string;
  timestamp: string;
  details?: string; // e.g., "In Progress → In Review", label name, comment preview
}
```

### 5. New CLI command (packages/cli/src/commands/standup.ts)

```
ghp standup [--since=<duration>] [--mine] [--json]
```

**Flags:**
- `--since` — Time window, e.g. `24h` (default), `8h`, `2d`, `2025-02-10`
- `--mine` — Only show issues assigned to the current user
- `--json` — JSON output (for scripting/MCP)

**Example output:**
```
Since yesterday (Feb 10, 07:30 MST) — 5 issues changed

#266 Fix caregiver break handling [In Progress → In Review]
  ↳ Status changed by bretwardjames (Feb 10, 14:22)
  ↳ 2 new comments
  ↳ PR #271 linked

#251 Add location sharing [Ready → In Progress]
  ↳ Assigned to bretwardjames (Feb 10, 09:15)
  ↳ Branch created: 251-add-location-sharing

#240 Dashboard redesign [In Review → Done]
  ↳ PR #265 merged by daxman95 (Feb 10, 16:40)
  ↳ Status changed to Done

#198 Fix notification badge count [Backlog]
  ↳ Labeled "bug" by bretwardjames (Feb 10, 11:00)

#302 Update dependencies (new)
  ↳ Created by bretwardjames (Feb 11, 06:45)
```

**Grouping:** By default, group by issue. Consider optional `--group-by=person` for team standups.

### 6. MCP tool (packages/mcp/src/server.ts)

Register a `standup` tool so Claude/AI agents can also pull this data:

```typescript
{
  name: "ghp_standup",
  description: "Get recent issue activity for standup summaries",
  inputSchema: {
    since: { type: "string", description: "Duration like '24h', '8h', '2d'" },
    mine: { type: "boolean", description: "Only my issues" },
  }
}
```

## Rate Limit Considerations

The two-pass approach is critical. A project with 100 items but only 5 changed in the last 24h should only make ~6 API calls (1 for project items + 5 for timelines), not 101. Given the 5000/hour GraphQL rate limit and the existing statusline polling, this needs to be efficient.

## Open Questions

- Should the command also show PR activity (reviews, approvals, merges) or just issue activity?
- Should it integrate with `ghp work` to show a combined "my standup" view?
- Worth caching the result so repeated calls in the same standup window don't re-fetch?

<!-- ghp-branch: bretwardjames/260-add-ghp-standup-command-for-daily-activity -->

## Plan

<!-- Implementation steps - fill in or let Claude generate -->

- [ ] TODO: Define implementation steps

## Acceptance Criteria

<!-- What needs to be true for this to be complete? -->

## Notes

<!-- Additional context, decisions, blockers -->


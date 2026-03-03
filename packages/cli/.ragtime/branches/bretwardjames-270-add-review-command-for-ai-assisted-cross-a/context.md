---
type: context
branch: bretwardjames/270-add-review-command-for-ai-assisted-cross-a
issue: 270
status: active
created: '2026-03-03'
author: bretwardjames
---

## Issue

**#270**: Add review command for AI-assisted cross-agent PR review



## Description

### The Task

Add a `ghp review` command that supports AI agent PR review workflows. The command handles data gathering, filtering, and dedup — leaving review judgment to the agent.

### Why

Teams using multiple AI agents need a structured way to batch-review PRs without duplicating findings. Currently agents must cobble together multiple `gh api` calls, parse raw JSON, and manually check for existing reviews. This is token-expensive, error-prone, and the dedup logic (a deterministic problem) shouldn't live in prompts.

### Commands

**`ghp review --pending`**
Returns structured JSON of PRs ready for review:
- Only PRs not authored by the current user
- Only PRs with passing CI
- Only PRs the current user hasn't already reviewed (or has reviewed but new commits were pushed since)
- Includes existing review comments (path, line, body) for dedup
- Includes metadata (files changed, additions/deletions, author)

```json
{
  "prs": [
    {
      "number": 611,
      "title": "Use number keyboard for phone auth",
      "author": "ericmartineau",
      "files_changed": 9,
      "additions": 687,
      "deletions": 92,
      "ci_status": "pass",
      "existing_reviews": [
        {
          "author": "bretwardjames",
          "state": "COMMENTED",
          "submitted_at": "2026-03-03T14:30:00Z",
          "body": "...",
          "inline_comments": [
            { "path": "file.dart", "line": 573, "body": "..." }
          ]
        }
      ]
    }
  ]
}
```

**`ghp review <pr>`**
Returns structured JSON for a single PR including diff, existing reviews, and inline comments — everything an agent needs to perform a review.

**`ghp review <pr> --submit`**
Submits a review via the API. Accepts review body + inline comments via stdin (JSON). Auto-appends configurable signoff (e.g., `_Review authored by Claude on behalf of @user_`).

### Design Principles

- **Deterministic logic in the tool**: CI filtering, "already reviewed" checks, existing comment dedup (path+line matching) — these are binary decisions that belong in code, not prompts
- **Judgment in the agent**: Analyzing diffs, writing review comments, deciding severity — these stay in the AI prompt
- **Structured output**: Pre-computed JSON so agents don't burn tokens parsing raw API responses

### Requirements

- [ ] `ghp review --pending` — list PRs needing review with existing comments
- [ ] `ghp review <pr>` — get full review context for a single PR
- [ ] `ghp review <pr> --submit` — submit review from stdin JSON with auto-signoff
- [ ] Filter out PRs where current user is author
- [ ] Filter out PRs with failing CI
- [ ] Filter out PRs already reviewed by current user (unless new commits since review)
- [ ] Include existing inline comments for dedup
- [ ] Configurable signoff text (default: `_Review authored by Claude on behalf of @{user}_`)
- [ ] `--format json` flag (default) for agent consumption

### Areas Affected

- New command module in packages/ghp-cli
- Uses existing gh API patterns from other commands

### Notes

- Companion to the cross-agent review workflow being adopted in the care repo
- The slash command that calls this will be thin — just pipes `--pending` output into agent review logic and `--submit` back
- See care repo discussion for full pipeline context

<!-- ghp-branch: bretwardjames/270-add-review-command-for-ai-assisted-cross-a -->

## Plan

<!-- Implementation steps - fill in or let Claude generate -->

- [ ] TODO: Define implementation steps

## Acceptance Criteria

<!-- What needs to be true for this to be complete? -->

## Notes

<!-- Additional context, decisions, blockers -->


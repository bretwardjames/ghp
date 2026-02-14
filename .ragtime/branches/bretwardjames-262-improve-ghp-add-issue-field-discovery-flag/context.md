---
type: context
branch: bretwardjames/262-improve-ghp-add-issue-field-discovery-flag
issue: 262
status: active
created: '2026-02-13'
author: bretwardjames
---

## Issue

**#262**: Improve ghp add issue: field discovery, flag parsing, and AI-agent ergonomics



## Description

## Summary

When using `ghp add issue` (especially from AI agents like Claude Code), several friction points make it difficult to one-shot issue creation with all fields set correctly. The core issues are: silent flag dropping, no field value discovery, and lack of confirmation output.

## Problems

### 1. Flags after positional title are silently ignored

```bash
# Body, labels, status, and field are all silently dropped:
ghp add issue --no-template --force-defaults \
  --status "Backlog" --field "Priority=Medium" --labels "mobile,security" \
  "My Issue Title" --body "This body is never set"
```

Commander.js stops parsing options after the positional \`[title]\` argument. No warning or error is shown — the issue is created without body, labels, or fields, and the user doesn't know until they check on GitHub.

**Suggestion:** Either (a) support flags after positional args, or (b) emit a warning when unrecognized trailing args are detected. Silent swallowing is the worst outcome.

### 2. No way to discover valid field values

```bash
ghp set-field 487 Size Small
# Error: Invalid value "Small" for field "Size"
# Available options: XS, S, M, L, XL
```

The error message helpfully shows valid options — but there's no way to discover this _before_ failing. AI agents (and humans) have to guess-and-fail.

**Suggestion:** Add a \`ghp fields\` command:

```
$ ghp fields
Status:   Backlog | Kill List | In Progress | In Review | Done
Priority: None | Low | Medium | High | Urgent
Size:     XS | S | M | L | XL
```

Or \`ghp fields --json\` for machine-readable output:

```json
{
  "Status": ["Backlog", "Kill List", "In Progress", "In Review", "Done"],
  "Priority": ["None", "Low", "Medium", "High", "Urgent"],
  "Size": ["XS", "S", "M", "L", "XL"]
}
```

### 3. No confirmation of what was actually applied

Current output:
```
Created: #487 iOS shift notes sheet is too transparent
Added to: War Time (pre-launch)
Status: Backlog
```

This doesn't tell you whether body, labels, priority, size, or assignee were set. You have to \`gh issue view\` to verify.

**Suggestion:** Verbose creation summary:

```
Created: #487 iOS shift notes sheet is too transparent
  Status:   Kill List ✓
  Priority: Medium ✓
  Size:     S ✓
  Assigned: bretwardjames ✓
  Labels:   (none)
  Body:     248 chars ✓
```

### 4. Named flags for common project fields

Currently, project-specific fields require generic \`--field "Priority=Medium"\` syntax. Since Priority, Size, and Status are near-universal on GitHub Projects, they could have first-class flags:

```bash
ghp add issue --priority Medium --size S --status "Kill List" --assign -b "..." "Title"
```

### 5. Body input is fragile for multi-paragraph content

Passing markdown through shell HEREDOC/escaping is error-prone (especially for AI agents). Suggestion:

```bash
# Read body from file
ghp add issue --body-file /tmp/issue-body.md "Title"

# Read body from stdin
echo "Issue body" | ghp add issue --body-stdin "Title"
```

## Context

These issues were discovered during a Claude Code session creating 7 issues in sequence. Every issue required a follow-up \`ghp set-field\` / \`ghp move\` / \`gh issue edit --body\` to fix what \`ghp add\` silently dropped. The workaround was to always use \`gh issue edit\` for body and \`ghp set-field\` for project fields after creation.

## Proposed Priority

1. **Flag parsing fix** (silent drop → warning/error) — highest impact, prevents confusion
2. **\`ghp fields\` command** — quick win, helps both humans and AI
3. **Verbose creation output** — helps verify without round-tripping to GitHub
4. **Named common field flags** — ergonomic improvement
5. **\`--body-file\` / \`--body-stdin\`** — nice-to-have for AI agent workflows

<!-- ghp-branch: bretwardjames/262-improve-ghp-add-issue-field-discovery-flag -->

## Plan

<!-- Implementation steps - fill in or let Claude generate -->

- [ ] TODO: Define implementation steps

## Acceptance Criteria

<!-- What needs to be true for this to be complete? -->

## Notes

<!-- Additional context, decisions, blockers -->


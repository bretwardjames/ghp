---
type: context
branch: bretwardjames/245-update-create-pr-command-to-clarify-ragtim
issue: 245
status: complete
created: '2026-02-02'
author: bretwardjames
---

## Issue

**#245**: Update create-pr command to clarify ragtime branch context should be committed

## Description

The `/create-pr` command didn't explicitly mention that the branch context file (`.ragtime/branches/{slug}/context.md`) should be committed as part of the PR. This context contains the implementation plan and decisions, which is valuable for reviewers.

## Changes Made

1. **Updated `packages/cli/slash-commands/claude/create-pr.md`**
   - Added "Before Creating the PR" section with bash script to check/stage context
   - Added "Important" section emphasizing branch context should be committed
   - Kept the original PR content requirements

2. **Updated `~/.claude/commands/create-pr.md`** (user's personal command)
   - Step 1: Added check for branch context.md with warning if missing
   - Step 5b: New step to stage branch context file
   - Step 6: Updated to commit both branch context and graduated knowledge
   - Step 7: Added "Branch Context" section to PR body template
   - Step 8: Updated summary to show branch context was committed
   - Notes: Added note explaining branch context is committed with PR

## Testing

- The updated command now explicitly checks for and stages the branch context file
- Warning message displayed if context.md is missing
- PR body template includes section for branch context

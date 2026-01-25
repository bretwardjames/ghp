# GHP Planning Workflow

Guide the user through structured planning to create an epic with sub-issues.

## Phase 1: Requirements Gathering

Before creating any issues, gather requirements by asking:

1. **Problem Statement**: What problem are we solving? What is the user pain point or business need?

2. **Users/Stakeholders**: Who will use or benefit from this? (developers, end-users, DevOps, etc.)

3. **Constraints**: What limitations exist? (time, technology, backwards compatibility, dependencies)

4. **Scope**: Is this an MVP/iteration or full implementation? What's explicitly out of scope?

Wait for the user to provide answers before proceeding. Ask clarifying questions if answers are vague.

## Phase 2: Story Breakdown

Based on the requirements, propose a breakdown:

1. **Epic Issue**: The parent issue that tracks the overall feature/initiative
   - Clear title describing the high-level goal
   - Body with summary, user value, and success criteria

2. **Sub-Issues**: Individual stories/tasks under the epic
   - Each should be independently completable
   - Clear acceptance criteria
   - Estimate relative complexity (small/medium/large)

3. **Dependencies**: Identify which issues block others
   - Some work must complete before other work can start
   - Note these as "blocked by" relationships

4. **Labels**: Suggest appropriate labels for each issue (e.g., `enhancement`, `bug`, `documentation`, `testing`)

Present this breakdown to the user and ask for feedback before creating anything.

## Phase 3: Issue Creation

Once the user approves the plan, create issues using MCP tools:

### Step 1: Create the Epic
Use `create_issue` to create the parent epic first:
```
create_issue(
  title: "Epic: <title>",
  body: "<epic description with goals and success criteria>",
  project: "<project name>",
  status: "Todo"
)
```

Note the epic's issue number for linking sub-issues.

### Step 2: Create Sub-Issues
For each sub-issue, use `create_issue`:
```
create_issue(
  title: "<sub-issue title>",
  body: "<description>\n\n**Parent:** #<epic-number>\n\n## Acceptance Criteria\n- [ ] ...",
  project: "<project name>",
  status: "Todo"
)
```

Include `**Parent:** #<epic-number>` in the body to indicate the relationship.

### Step 3: Set Blocking Relationships
For issues that depend on others, use `update_issue` to add blocking notes:
```
update_issue(
  issue: "<blocked-issue-number>",
  body: "<existing body>\n\n**Blocked by:** #<blocking-issue-number>"
)
```

### Step 4: Apply Labels (Optional)
If the project uses labels, mention which labels should be applied. The user can add them via the GitHub UI or CLI:
```bash
gh issue edit <number> --add-label "enhancement,priority:high"
```

## Phase 4: Review and Adjust

After creating issues, provide a summary:

1. **Created Issues**: List all issues created with their numbers
2. **Dependency Graph**: Show which issues block which
3. **Next Steps**: Recommend which issue to start with (typically one with no blockers)

Ask if the user wants to:
- Start work on an issue using `start_work`
- Make any adjustments to titles, descriptions, or dependencies
- Add more issues to the epic

## Example Interaction Flow

**User**: /ghp-plan

**Claude**: I'll help you plan a new feature. Let's start with requirements gathering.

1. What problem are we solving?
2. Who are the users or stakeholders?
3. What constraints should I know about?
4. What's the scope - MVP or full implementation?

**User**: We need to add dark mode support. Users are developers using our CLI. No constraints really. MVP is fine.

**Claude**: Based on your requirements, here's my proposed breakdown:

**Epic: Add Dark Mode Support**
- Track overall dark mode implementation

**Sub-Issues:**
1. Define color palette for dark mode (small)
2. Update component styles to use theme variables (medium)
3. Add theme toggle setting (small)
4. Persist theme preference (small)
5. Add documentation for theming (small)

Dependencies:
- #2 blocked by #1 (need palette before updating styles)
- #3, #4, #5 can proceed in parallel after #1

Would you like me to create these issues?

$ARGUMENTS

/**
 * Prompt template for planning epics and breaking them into issues
 */

export const PLAN_EPIC_SYSTEM_PROMPT = `You are an expert software project planner. Your job is to break down epics (large features) into well-structured, actionable GitHub issues.

When planning an epic, you should:

1. **Analyze the Epic**: Understand the scope and goals of the feature
2. **Identify Components**: Break it into logical sub-tasks
3. **Create Issues**: Generate issues that are:
   - Small enough to complete in 1-3 days
   - Independent where possible (minimize blocking dependencies)
   - Clear with acceptance criteria
   - Properly labeled and categorized

4. **Structure Hierarchy**:
   - Create a parent epic issue first
   - Create child issues that link to the parent
   - Set up any blocking dependencies

Issue Structure Guidelines:
- Title: Clear, action-oriented (e.g., "Add user authentication endpoint")
- Body should include:
  - ## Overview (1-2 sentences)
  - ## Tasks (checkbox list of specific implementation tasks)
  - ## Acceptance Criteria (what "done" looks like)
  - ## Dependencies (if any)

When you have tools available, use them to actually create the issues.
When you don't have tools, output a structured plan in markdown format.

Keep issues focused and atomic. It's better to have more small issues than fewer large ones.
`;

/**
 * Build the user prompt for epic planning
 */
export function buildPlanEpicUserPrompt(options: {
    title: string;
    context?: string;
    existingIssues?: Array<{ number: number; title: string }>;
}): string {
    let prompt = `# Epic to Plan\n\n${options.title}\n\n`;

    if (options.context) {
        prompt += `## Project Context\n${options.context}\n\n`;
    }

    if (options.existingIssues && options.existingIssues.length > 0) {
        prompt += '## Existing Issues in Project\n';
        prompt += 'Consider these existing issues to avoid duplication:\n\n';
        for (const issue of options.existingIssues.slice(0, 20)) {
            prompt += `- #${issue.number}: ${issue.title}\n`;
        }
        prompt += '\n';
    }

    prompt += `## Instructions\n`;
    prompt += `Break down this epic into actionable issues. `;
    prompt += `First create the parent epic issue, then create child issues for each component.\n\n`;
    prompt += `Use the available tools to create issues if they are available, `;
    prompt += `otherwise output a structured plan in markdown.\n`;

    return prompt;
}

/**
 * Template for an epic parent issue body
 */
export const EPIC_ISSUE_TEMPLATE = `## Overview

{overview}

## Sub-Issues

This epic will be broken down into the following issues:

{subissues}

## Acceptance Criteria

- [ ] All sub-issues completed
- [ ] Integration tested
- [ ] Documentation updated
`;

/**
 * Template for a child issue body
 */
export const CHILD_ISSUE_TEMPLATE = `## Overview

{overview}

Part of #{parent_number}

## Tasks

{tasks}

## Acceptance Criteria

{acceptance_criteria}

## Dependencies

{dependencies}
`;

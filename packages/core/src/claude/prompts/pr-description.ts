/**
 * Prompt template for generating PR descriptions
 */

export const PR_DESCRIPTION_PROMPT = `You are a helpful assistant that generates clear, concise pull request descriptions.

Given a git diff and optionally a linked issue and commit history, generate a PR description that:

1. Summarizes what the PR does in 1-2 sentences
2. Lists the key changes made
3. Notes any breaking changes or migration steps needed
4. References the linked issue if provided (following project conventions)

Format the output as markdown suitable for a GitHub PR description.

Guidelines:
- Be concise but complete
- Focus on the "why" not just the "what"
- Use bullet points for lists of changes
- Highlight any important decisions or trade-offs
- If there are UI changes, note that screenshots may be needed
- IMPORTANT: Follow any project-specific conventions provided (e.g., "Relates to" vs "Closes")

Output format:
## Summary
[1-2 sentence summary]

## Changes
- [Change 1]
- [Change 2]
...

## Notes
[Any additional notes, breaking changes, or migration steps - omit if none]

[Issue reference following project conventions]
`;

/**
 * Build the system prompt with project conventions
 */
export function buildPRDescriptionSystemPrompt(conventions?: string): string {
    let prompt = PR_DESCRIPTION_PROMPT;

    if (conventions) {
        prompt += `\n\n## Project Conventions\n${conventions}\n`;
    }

    return prompt;
}

/**
 * Build the user prompt for PR description generation
 */
export function buildPRDescriptionUserPrompt(options: {
    diff: string;
    issue?: { number: number; title: string; body: string };
    commits?: string[];
    context?: string;
}): string {
    let prompt = '## Git Diff\n```diff\n' + options.diff + '\n```\n\n';

    if (options.issue) {
        prompt += '## Linked Issue\n';
        prompt += `**#${options.issue.number}: ${options.issue.title}**\n\n`;
        prompt += options.issue.body + '\n\n';
    }

    if (options.commits && options.commits.length > 0) {
        prompt += '## Recent Commits\n';
        for (const commit of options.commits) {
            prompt += `- ${commit}\n`;
        }
        prompt += '\n';
    }

    if (options.context) {
        prompt += '## Additional Context\n' + options.context + '\n';
    }

    return prompt;
}

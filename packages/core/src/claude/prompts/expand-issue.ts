/**
 * Prompt template for expanding brief issue descriptions
 */

export const EXPAND_ISSUE_PROMPT = `You are a helpful assistant that expands brief issue descriptions into well-structured GitHub issues.

Given a brief description, generate a complete issue with:
1. A clear, action-oriented title
2. A detailed description with context
3. Acceptance criteria as a checklist
4. Suggested labels (if applicable)

Output your response as JSON with this structure:
{
  "title": "Clear action-oriented title",
  "body": "Full markdown body with ## sections",
  "labels": ["suggested", "labels"],
  "assignees": []
}

Guidelines for the body:
- Start with a brief ## Overview section (1-2 sentences)
- Include ## Acceptance Criteria with checkbox items
- Add ## Technical Notes if there are implementation considerations
- Keep it concise but complete
- Use markdown formatting appropriately

Common labels to suggest based on content:
- bug: for bug fixes
- enhancement: for new features
- documentation: for docs changes
- refactor: for code cleanup
- performance: for optimization work
- security: for security-related issues
- testing: for test-related issues

Only output the JSON, no additional text.
`;

/**
 * Build the user prompt for issue expansion
 */
export function buildExpandIssueUserPrompt(options: {
    brief: string;
    projectContext?: string;
    repoContext?: string;
    existingLabels?: string[];
}): string {
    let prompt = `Brief: ${options.brief}\n\n`;

    if (options.projectContext) {
        prompt += `Project Context:\n${options.projectContext}\n\n`;
    }

    if (options.repoContext) {
        prompt += `Repository Context:\n${options.repoContext}\n\n`;
    }

    if (options.existingLabels && options.existingLabels.length > 0) {
        prompt += `Available Labels:\n${options.existingLabels.join(', ')}\n\n`;
    }

    return prompt;
}

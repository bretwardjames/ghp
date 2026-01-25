/**
 * AI-powered issue suggestion from code
 *
 * Uses Claude to suggest GitHub issues based on selected code or TODOs.
 */

import * as vscode from 'vscode';
import { ClaudeClient } from '@bretwardjames/ghp-core';
import { ApiKeyManager } from './api-key-manager';

const SUGGEST_ISSUE_SYSTEM_PROMPT = `You are a helpful assistant that creates GitHub issues from code context.

Given code or a TODO comment, generate a well-structured GitHub issue with:
1. A clear, concise title (imperative mood, max 60 chars)
2. A description that explains:
   - What needs to be done
   - Why it's needed (if apparent from context)
   - Any relevant technical details
3. Acceptance criteria as a checklist (if applicable)
4. Suggested labels (choose from: bug, enhancement, documentation, refactor, performance, security, testing)

Output your response as JSON with this format:
{
  "title": "Issue title",
  "body": "Issue body in markdown",
  "labels": ["label1", "label2"]
}

Only output the JSON, nothing else.`;

interface SuggestedIssue {
    title: string;
    body: string;
    labels?: string[];
}

/**
 * Execute the suggest issue command
 */
export async function executeSuggestIssue(apiKeyManager: ApiKeyManager): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor. Open a file and optionally select some code.');
        return;
    }

    // Get selected text or try to detect TODO at cursor
    let selectedText = '';
    let contextType = 'code';

    const selection = editor.selection;
    if (!selection.isEmpty) {
        selectedText = editor.document.getText(selection);
    } else {
        // Try to find TODO on current line
        const line = editor.document.lineAt(selection.active.line);
        const todoMatch = line.text.match(/(?:TODO|FIXME|HACK|XXX|BUG)[\s:]+(.+)/i);
        if (todoMatch) {
            selectedText = line.text;
            contextType = 'todo';
        }
    }

    if (!selectedText.trim()) {
        // Ask user what they want to create an issue about
        selectedText = await vscode.window.showInputBox({
            prompt: 'Describe the issue you want to create',
            placeHolder: 'e.g., Add validation for user input in the login form',
            ignoreFocusOut: true,
        }) || '';

        if (!selectedText.trim()) {
            return;
        }
        contextType = 'description';
    }

    // Get file context
    const fileName = editor.document.fileName.split('/').pop() || 'file';
    const languageId = editor.document.languageId;
    const startLine = selection.isEmpty ? selection.active.line + 1 : selection.start.line + 1;

    // Ensure we have an API key
    const apiKey = await apiKeyManager.ensureApiKey();
    if (!apiKey) {
        return;
    }

    // Create Claude client
    const claude = new ClaudeClient({
        apiKeyProvider: apiKeyManager,
    });

    // Generate issue with progress
    const issue = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Generating issue suggestion...',
            cancellable: false,
        },
        async (): Promise<SuggestedIssue | null> => {
            try {
                let userMessage = '';

                if (contextType === 'todo') {
                    userMessage = `Create a GitHub issue from this TODO comment found in ${fileName} (line ${startLine}):

${selectedText}`;
                } else if (contextType === 'description') {
                    userMessage = `Create a GitHub issue from this description:

${selectedText}`;
                } else {
                    userMessage = `Create a GitHub issue based on this ${languageId} code from ${fileName} (starting at line ${startLine}):

\`\`\`${languageId}
${selectedText}
\`\`\`

Analyze the code and suggest an appropriate issue. This could be:
- A bug fix if there are potential issues
- A refactoring task if the code could be improved
- An enhancement if the code suggests missing functionality
- Documentation if the code is complex but lacks comments`;
                }

                const result = await claude.complete({
                    system: SUGGEST_ISSUE_SYSTEM_PROMPT,
                    messages: [{ role: 'user', content: userMessage }],
                    maxTokens: 1500,
                });

                // Parse JSON response
                try {
                    // Try to extract JSON from response (in case there's extra text)
                    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        return JSON.parse(jsonMatch[0]) as SuggestedIssue;
                    }
                    return JSON.parse(result.text) as SuggestedIssue;
                } catch {
                    // If JSON parsing fails, create a basic issue
                    return {
                        title: 'New Issue',
                        body: result.text,
                    };
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to generate issue: ${errorMessage}`);
                return null;
            }
        }
    );

    if (!issue) {
        return;
    }

    // Show the suggested issue and offer options
    const action = await vscode.window.showInformationMessage(
        `Suggested Issue: ${issue.title}`,
        { modal: true, detail: issue.body },
        'Create Issue',
        'Edit & Create',
        'Copy to Clipboard'
    );

    if (action === 'Create Issue') {
        // Open the planning board with this issue pre-filled
        // First copy to clipboard, then open planning board
        await vscode.env.clipboard.writeText(`${issue.title}\n\n${issue.body}`);

        // Try to open the new issue form
        await vscode.commands.executeCommand('ghProjects.newIssue');
        vscode.window.showInformationMessage(
            'Issue details copied to clipboard. Paste in the new issue form.'
        );
    } else if (action === 'Edit & Create') {
        // Let user edit title and body
        const editedTitle = await vscode.window.showInputBox({
            value: issue.title,
            prompt: 'Edit issue title',
            ignoreFocusOut: true,
        });

        if (!editedTitle) {
            return;
        }

        // Show body in a quick pick with edit option or use document
        const editedBody = await vscode.window.showInputBox({
            value: issue.body.substring(0, 200) + '...',
            prompt: 'Edit issue body (truncated for input box)',
            ignoreFocusOut: true,
        });

        const finalBody = editedBody || issue.body;

        await vscode.env.clipboard.writeText(`${editedTitle}\n\n${finalBody}`);
        await vscode.commands.executeCommand('ghProjects.newIssue');
        vscode.window.showInformationMessage(
            'Edited issue details copied to clipboard. Paste in the new issue form.'
        );
    } else if (action === 'Copy to Clipboard') {
        const issueText = `# ${issue.title}\n\n${issue.body}${
            issue.labels && issue.labels.length > 0
                ? `\n\nSuggested labels: ${issue.labels.join(', ')}`
                : ''
        }`;
        await vscode.env.clipboard.writeText(issueText);
        vscode.window.showInformationMessage('Issue suggestion copied to clipboard');
    }
}

/**
 * AI-powered commit message generation
 *
 * Uses Claude to generate meaningful commit messages from staged changes.
 */

import * as vscode from 'vscode';
import { ClaudeClient } from '@bretwardjames/ghp-core';
import { ApiKeyManager } from './api-key-manager';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const COMMIT_MESSAGE_SYSTEM_PROMPT = `You are an expert at writing clear, concise git commit messages following conventional commit format.

Given a git diff of staged changes, generate a commit message that:
1. Uses conventional commit format: type(scope): description
2. Types include: feat, fix, docs, style, refactor, test, chore, perf, ci, build
3. Scope is optional but helpful for larger projects
4. Subject line is imperative mood, lowercase, no period, max 72 chars
5. If needed, add a blank line followed by a body explaining WHY (not what)

Only output the commit message, nothing else. Do not include markdown formatting or code blocks.`;

/**
 * Get the staged diff from git
 */
async function getStagedDiff(cwd: string): Promise<string | null> {
    try {
        const { stdout } = await execAsync('git diff --cached', { cwd });
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

/**
 * Get the list of staged files
 */
async function getStagedFiles(cwd: string): Promise<string[]> {
    try {
        const { stdout } = await execAsync('git diff --cached --name-only', { cwd });
        return stdout.trim().split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

/**
 * Get the current branch name
 */
async function getCurrentBranch(cwd: string): Promise<string | null> {
    try {
        const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd });
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

/**
 * Execute the generate commit message command
 */
export async function executeGenerateCommitMessage(apiKeyManager: ApiKeyManager): Promise<void> {
    // Get workspace path
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }
    const cwd = workspaceFolders[0].uri.fsPath;

    // Check for staged changes
    const stagedFiles = await getStagedFiles(cwd);
    if (stagedFiles.length === 0) {
        vscode.window.showWarningMessage('No staged changes. Stage some changes with "git add" first.');
        return;
    }

    // Get the staged diff
    const diff = await getStagedDiff(cwd);
    if (!diff) {
        vscode.window.showWarningMessage('Could not get staged diff');
        return;
    }

    // Ensure we have an API key
    const apiKey = await apiKeyManager.ensureApiKey();
    if (!apiKey) {
        return;
    }

    // Create Claude client
    const claude = new ClaudeClient({
        apiKeyProvider: apiKeyManager,
    });

    // Generate commit message with progress
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Generating commit message...',
            cancellable: false,
        },
        async () => {
            try {
                // Get additional context
                const branch = await getCurrentBranch(cwd);
                let userMessage = `## Staged Changes (${stagedFiles.length} files)\n`;
                userMessage += `Files: ${stagedFiles.join(', ')}\n\n`;
                if (branch) {
                    userMessage += `Current branch: ${branch}\n\n`;
                }
                userMessage += `## Diff\n\`\`\`diff\n${diff}\n\`\`\``;

                const result = await claude.complete({
                    system: COMMIT_MESSAGE_SYSTEM_PROMPT,
                    messages: [{ role: 'user', content: userMessage }],
                    maxTokens: 500,
                });

                const commitMessage = result.text.trim();

                // Show the commit message and offer options
                const action = await vscode.window.showInformationMessage(
                    commitMessage,
                    { modal: true, detail: 'Generated commit message:' },
                    'Copy to Clipboard',
                    'Insert in Terminal',
                    'Edit in Input Box'
                );

                if (action === 'Copy to Clipboard') {
                    await vscode.env.clipboard.writeText(commitMessage);
                    vscode.window.showInformationMessage('Commit message copied to clipboard');
                } else if (action === 'Insert in Terminal') {
                    // Find or create terminal and send the commit command
                    const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('Git');
                    terminal.show();
                    // Escape single quotes in the message
                    const escapedMessage = commitMessage.replace(/'/g, "'\\''");
                    terminal.sendText(`git commit -m '${escapedMessage}'`, false);
                } else if (action === 'Edit in Input Box') {
                    // Let user edit the message
                    const editedMessage = await vscode.window.showInputBox({
                        value: commitMessage,
                        prompt: 'Edit commit message',
                        ignoreFocusOut: true,
                    });

                    if (editedMessage) {
                        await vscode.env.clipboard.writeText(editedMessage);
                        vscode.window.showInformationMessage('Edited commit message copied to clipboard');
                    }
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to generate commit message: ${errorMessage}`);
            }
        }
    );
}

import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository } from '../git-utils.js';
import { spawn } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export async function editCommand(issue: string): Promise<void> {
    const repo = await detectRepository();
    if (!repo) {
        console.error(chalk.red('Error:'), 'Not in a git repository with a GitHub remote');
        process.exit(1);
    }

    const authenticated = await api.authenticate();
    if (!authenticated) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run', chalk.cyan('ghp auth'));
        process.exit(1);
    }

    const issueNumber = parseInt(issue.replace(/^#/, ''), 10);
    if (isNaN(issueNumber)) {
        console.error(chalk.red('Invalid issue number:'), issue);
        process.exit(1);
    }

    // Fetch current issue details
    const details = await api.getIssueDetails(repo, issueNumber);
    if (!details) {
        console.error(chalk.red('Issue not found:'), `#${issueNumber}`);
        process.exit(1);
    }

    console.log(chalk.dim(`Editing #${issueNumber}: ${details.title}`));

    // Open editor with current title and description
    const result = await openEditor(issueNumber, details.title, details.body || '');

    // Normalize for comparison (same normalization as openEditor parsing)
    const normalizedOriginalBody = normalizeBody(details.body || '');

    // Check if anything changed
    const titleChanged = result.title.trim() !== details.title.trim();
    const bodyChanged = result.body !== normalizedOriginalBody;

    if (!titleChanged && !bodyChanged) {
        console.log(chalk.yellow('No changes made'));
        return;
    }

    // Check if title is empty
    if (!result.title.trim()) {
        console.error(chalk.red('Error:'), 'Title cannot be empty');
        process.exit(1);
    }

    // Update the issue
    console.log(chalk.dim('Updating issue...'));
    const success = await api.updateIssue(repo, issueNumber, {
        title: titleChanged ? result.title : undefined,
        body: bodyChanged ? result.body : undefined,
    });

    if (success) {
        const changes = [];
        if (titleChanged) changes.push('title');
        if (bodyChanged) changes.push('description');
        console.log(chalk.green('Updated'), `#${issueNumber}`, chalk.dim(`(${changes.join(', ')})`));
    } else {
        console.error(chalk.red('Failed to update issue'));
        process.exit(1);
    }
}

interface EditResult {
    title: string;
    body: string;
}

/**
 * Normalize body text to match how openEditor parses it.
 * This ensures we can accurately detect if changes were made.
 */
function normalizeBody(body: string): string {
    // Match the parsing logic: trim leading empty lines and trailing whitespace
    const lines = body.split('\n');

    // Skip leading empty lines (matches openEditor behavior)
    let startIndex = 0;
    while (startIndex < lines.length && !lines[startIndex].trim()) {
        startIndex++;
    }

    return lines.slice(startIndex).join('\n').trimEnd();
}

async function openEditor(issueNumber: number, currentTitle: string, currentBody: string): Promise<EditResult> {
    const editor = process.env.EDITOR || process.env.VISUAL || 'vim';
    const tmpFile = join(tmpdir(), `ghp-edit-${issueNumber}-${Date.now()}.md`);

    // Create temp file with editable title, instructions, and body
    const content = [
        currentTitle,
        '',
        '# ─────────────────────────────────────────────',
        `# Editing Issue #${issueNumber}`,
        '# First line = title, everything below = description',
        '# Lines starting with # are ignored',
        '# ─────────────────────────────────────────────',
        '',
        currentBody,
    ].join('\n');

    writeFileSync(tmpFile, content);

    return new Promise((resolve, reject) => {
        const child = spawn(editor, [tmpFile], {
            stdio: 'inherit',
        });

        child.on('exit', (code) => {
            if (code !== 0) {
                if (existsSync(tmpFile)) unlinkSync(tmpFile);
                reject(new Error(`Editor exited with code ${code}`));
                return;
            }

            try {
                const fileContent = readFileSync(tmpFile, 'utf-8');
                unlinkSync(tmpFile);

                // Parse the content
                const lines = fileContent.split('\n');
                const nonCommentLines: string[] = [];

                for (const line of lines) {
                    if (!line.startsWith('#')) {
                        nonCommentLines.push(line);
                    }
                }

                // First non-empty line is the title
                let title = '';
                let bodyStartIndex = 0;

                for (let i = 0; i < nonCommentLines.length; i++) {
                    if (nonCommentLines[i].trim()) {
                        title = nonCommentLines[i].trim();
                        bodyStartIndex = i + 1;
                        break;
                    }
                }

                // Skip empty lines between title and body
                while (bodyStartIndex < nonCommentLines.length && !nonCommentLines[bodyStartIndex].trim()) {
                    bodyStartIndex++;
                }

                // Rest is the body
                const body = nonCommentLines.slice(bodyStartIndex).join('\n').trimEnd();

                resolve({ title, body });
            } catch (err) {
                reject(err);
            }
        });
    });
}

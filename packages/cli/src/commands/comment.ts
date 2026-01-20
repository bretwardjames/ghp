import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository } from '../git-utils.js';
import { spawn } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

interface CommentOptions {
    message?: string;
}

export async function commentCommand(issue: string, options: CommentOptions): Promise<void> {
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

    // Get issue details to show context
    const details = await api.getIssueDetails(repo, issueNumber);
    if (!details) {
        console.error(chalk.red('Issue not found:'), `#${issueNumber}`);
        process.exit(1);
    }

    let commentBody: string;

    if (options.message) {
        // Inline comment
        commentBody = options.message;
    } else {
        // Open editor
        console.log(chalk.dim(`Commenting on #${issueNumber}: ${details.title}`));
        commentBody = await openEditor(issueNumber);
    }

    // Trim and validate
    commentBody = commentBody.trim();
    if (!commentBody) {
        console.log(chalk.yellow('Aborted:'), 'Empty comment');
        return;
    }

    // Post the comment
    console.log(chalk.dim('Posting comment...'));
    const success = await api.addComment(repo, issueNumber, commentBody);

    if (success) {
        console.log(chalk.green('Comment added to'), `#${issueNumber}`);
    } else {
        console.error(chalk.red('Failed to add comment'));
        process.exit(1);
    }
}

async function openEditor(issueNumber: number): Promise<string> {
    const editor = process.env.EDITOR || process.env.VISUAL || 'vim';
    const tmpFile = join(tmpdir(), `ghp-comment-${issueNumber}-${Date.now()}.md`);

    writeFileSync(tmpFile, '');

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
                const content = readFileSync(tmpFile, 'utf-8');
                unlinkSync(tmpFile);
                resolve(content);
            } catch (err) {
                reject(err);
            }
        });
    });
}

import chalk from 'chalk';
import { api, type IssueDetails } from '../github-api.js';
import { detectRepository } from '../git-utils.js';
import { parseBranchLink } from '@bretwardjames/ghp-core';
import type { ProjectItem } from '../types.js';
import { exit } from '../exit.js';

interface OpenOptions {
    browser?: boolean;
}

export async function openCommand(issue: string, options: OpenOptions): Promise<void> {
    const repo = await detectRepository();
    if (!repo) {
        console.error(chalk.red('Error:'), 'Not in a git repository with a GitHub remote');
        exit(1);
    }

    const authenticated = await api.authenticate();
    if (!authenticated) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run', chalk.cyan('ghp auth'));
        exit(1);
    }

    const issueNumber = parseInt(issue.replace(/^#/, ''), 10);
    if (isNaN(issueNumber)) {
        console.error(chalk.red('Invalid issue number:'), issue);
        exit(1);
    }

    // Fetch both project item data and full issue details in parallel
    const [item, details] = await Promise.all([
        api.findItemByNumber(repo, issueNumber),
        api.getIssueDetails(repo, issueNumber),
    ]);

    if (!details) {
        console.error(chalk.red('Issue not found:'), `#${issueNumber}`);
        exit(1);
    }

    // Open in browser if --browser flag
    if (options.browser) {
        const url = item?.url || `https://github.com/${repo.owner}/${repo.name}/issues/${issueNumber}`;
        const { exec } = await import('child_process');
        const openCmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32' ? 'start'
            : 'xdg-open';
        exec(`${openCmd} "${url}"`);
        console.log(chalk.green('Opened in browser'));
        return;
    }

    // Display full issue details
    displayIssue(details, item, issueNumber, repo.fullName);
}

function displayIssue(
    details: IssueDetails,
    item: ProjectItem | null,
    issueNumber: number,
    repoName: string
): void {
    const width = Math.min(process.stdout.columns || 80, 100);
    const divider = chalk.dim('─'.repeat(width));

    // Header
    console.log();
    const typeIcon = details.type === 'pull_request' ? chalk.magenta('⎇ PR')
        : chalk.green('● Issue');
    const stateColor = details.state === 'OPEN' ? chalk.green : chalk.red;

    console.log(`${typeIcon} ${chalk.cyan(`#${issueNumber}`)} ${stateColor(`[${details.state}]`)}`);
    console.log(chalk.bold(details.title));
    console.log();

    // Metadata section
    console.log(divider);

    // Author & Date
    const createdDate = new Date(details.createdAt).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
    });
    console.log(`${chalk.dim('Author:')}      ${chalk.cyan('@' + details.author)} ${chalk.dim('on')} ${createdDate}`);

    // Labels
    if (details.labels.length > 0) {
        const labelStr = details.labels.map(l => {
            const bg = hexToChalk(l.color);
            return bg(` ${l.name} `);
        }).join(' ');
        console.log(`${chalk.dim('Labels:')}      ${labelStr}`);
    }

    // Project fields (if linked to a project)
    if (item) {
        console.log(`${chalk.dim('Project:')}     ${item.projectTitle}`);

        if (item.assignees.length > 0) {
            console.log(`${chalk.dim('Assignees:')}   ${item.assignees.map(a => chalk.cyan('@' + a)).join(', ')}`);
        }

        // Display all project custom fields
        const fieldEntries = Object.entries(item.fields);
        if (fieldEntries.length > 0) {
            console.log();
            console.log(chalk.dim('Project Fields:'));
            for (const [name, value] of fieldEntries) {
                const displayValue = name === 'Status'
                    ? getStatusColor(value)(value)
                    : value;
                console.log(`  ${chalk.dim(name + ':')} ${displayValue}`);
            }
        }
    } else {
        console.log(chalk.dim('(Not linked to any project)'));
    }

    // URL
    const url = item?.url || `https://github.com/${repoName.split('/')[0]}/${repoName.split('/')[1]}/issues/${issueNumber}`;
    console.log(`${chalk.dim('URL:')}         ${chalk.underline(url)}`);

    // Linked branch
    const linkedBranch = parseBranchLink(details.body);
    if (linkedBranch) {
        console.log(`${chalk.dim('Branch:')}      ${chalk.cyan('🔗')} ${chalk.green(linkedBranch)}`);
    }

    // Description
    console.log();
    console.log(divider);
    console.log(chalk.bold('Description'));
    console.log();

    // Strip the branch link comment from displayed body
    const displayBody = details.body
        ? details.body.replace(/<!--\s*ghp-branch:\s*.+?\s*-->\s*/g, '').trim()
        : '';

    if (displayBody) {
        console.log(formatMarkdown(displayBody));
    } else {
        console.log(chalk.dim('No description provided.'));
    }

    // Comments
    if (details.comments.length > 0 || details.totalComments > 0) {
        console.log();
        console.log(divider);
        const commentLabel = details.totalComments === 1 ? 'Comment' : 'Comments';
        console.log(chalk.bold(`${commentLabel} (${details.totalComments})`));

        for (const comment of details.comments) {
            console.log();
            const commentDate = new Date(comment.createdAt).toLocaleDateString('en-US', {
                year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
            console.log(`${chalk.cyan('@' + comment.author)} ${chalk.dim('·')} ${chalk.dim(commentDate)}`);
            console.log(formatMarkdown(comment.body));
        }

        if (details.totalComments > details.comments.length) {
            console.log();
            console.log(chalk.dim(`... and ${details.totalComments - details.comments.length} more comments`));
        }
    }

    // Actions hint
    console.log();
    console.log(divider);
    console.log(chalk.dim('Actions:'));
    console.log(`  ${chalk.cyan(`ghp comment ${issueNumber}`)}         ${chalk.dim('Add a comment')}`);
    console.log(`  ${chalk.cyan(`ghp move ${issueNumber} <status>`)}   ${chalk.dim('Change status')}`);
    console.log(`  ${chalk.cyan(`ghp assign ${issueNumber}`)}          ${chalk.dim('Assign to yourself')}`);
    console.log(`  ${chalk.cyan(`ghp start ${issueNumber}`)}           ${chalk.dim('Start working')}`);
    console.log(`  ${chalk.cyan(`ghp open ${issueNumber} --browser`)}  ${chalk.dim('Open in browser')}`);
    console.log();
}

function getStatusColor(status: string | null): (text: string) => string {
    if (!status) return chalk.dim;
    switch (status.toLowerCase()) {
        case 'in progress':
            return chalk.yellow;
        case 'todo':
        case 'backlog':
            return chalk.blue;
        case 'in review':
            return chalk.magenta;
        case 'done':
        case 'closed':
        case 'completed':
            return chalk.green;
        default:
            return chalk.white;
    }
}

function hexToChalk(hex: string): (text: string) => string {
    // Convert GitHub label hex color to a chalk background
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);

    // Determine if we need light or dark text
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const textColor = luminance > 0.5 ? chalk.black : chalk.white;

    return (text: string) => textColor.bgRgb(r, g, b)(text);
}

function formatMarkdown(text: string): string {
    // Basic markdown formatting for terminal
    let formatted = text;

    // Code blocks
    formatted = formatted.replace(/```[\s\S]*?```/g, (match) => {
        const code = match.replace(/```\w*\n?/g, '').replace(/```$/g, '');
        return chalk.dim('┌──') + '\n' +
            code.split('\n').map(line => chalk.dim('│ ') + chalk.cyan(line)).join('\n') +
            '\n' + chalk.dim('└──');
    });

    // Inline code
    formatted = formatted.replace(/`([^`]+)`/g, (_, code) => chalk.cyan(code));

    // Bold
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, (_, text) => chalk.bold(text));

    // Links [text](url)
    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) =>
        `${text} ${chalk.dim('(' + url + ')')}`
    );

    // Headers
    formatted = formatted.replace(/^#{1,6}\s+(.+)$/gm, (_, text) => chalk.bold(text));

    // Blockquotes
    formatted = formatted.replace(/^>\s+(.+)$/gm, (_, text) => chalk.dim('│ ') + chalk.italic(text));

    // Lists
    formatted = formatted.replace(/^[-*]\s+/gm, '  • ');
    formatted = formatted.replace(/^\d+\.\s+/gm, (match) => '  ' + match);

    return formatted;
}

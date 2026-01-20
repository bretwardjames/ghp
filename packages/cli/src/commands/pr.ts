import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { api } from '../github-api.js';
import { detectRepository, getCurrentBranch } from '../git-utils.js';
import { getIssueForBranch } from '../branch-linker.js';
import { getConfig } from '../config.js';

const execAsync = promisify(exec);

interface PrOptions {
    create?: boolean;
    open?: boolean;
}

export async function prCommand(issue: string | undefined, options: PrOptions): Promise<void> {
    // Detect repository
    const repo = await detectRepository();
    if (!repo) {
        console.error(chalk.red('Error:'), 'Not in a git repository with a GitHub remote');
        process.exit(1);
    }

    // Authenticate
    const authenticated = await api.authenticate();
    if (!authenticated) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run', chalk.cyan('ghp auth'));
        process.exit(1);
    }

    const currentBranch = await getCurrentBranch();
    if (!currentBranch) {
        console.error(chalk.red('Error:'), 'Could not determine current branch');
        process.exit(1);
    }

    // If issue not specified, try to find linked issue for current branch
    let issueNumber: number | null = null;
    let linkedIssue = await getIssueForBranch(repo, currentBranch);

    if (issue) {
        issueNumber = parseInt(issue, 10);
        if (isNaN(issueNumber)) {
            console.error(chalk.red('Error:'), 'Issue must be a number');
            process.exit(1);
        }
    } else if (linkedIssue) {
        issueNumber = linkedIssue.issueNumber;
        console.log(chalk.dim(`Using linked issue #${issueNumber}: ${linkedIssue.issueTitle}`));
    }

    if (options.create) {
        await createPr(repo.fullName, issueNumber, linkedIssue?.issueTitle);
    } else if (options.open) {
        await openPr();
    } else {
        // Default: show PR status
        await showPrStatus(issueNumber);
    }
}

async function createPr(
    repoFullName: string,
    issueNumber: number | null,
    issueTitle: string | undefined
): Promise<void> {
    try {
        // Build title from issue if available
        let title = '';
        let body = '';

        if (issueNumber && issueTitle) {
            title = issueTitle;
            body = `Related to #${issueNumber}`;
        }

        // Use gh CLI to create PR
        const titleArg = title ? `--title "${title}"` : '';
        const bodyArg = body ? `--body "${body}"` : '';

        console.log(chalk.dim('Creating PR...'));

        const { stdout } = await execAsync(`gh pr create ${titleArg} ${bodyArg} --web`);
        console.log(stdout);

        // Update issue status if configured
        if (issueNumber) {
            const prOpenedStatus = getConfig('startWorkingStatus'); // TODO: add prOpenedStatus to config
            // Could update status here
        }
    } catch (error: unknown) {
        const err = error as { stderr?: string };
        if (err.stderr?.includes('already exists')) {
            console.log(chalk.yellow('PR already exists for this branch.'));
            await openPr();
        } else {
            console.error(chalk.red('Error creating PR:'), err.stderr || error);
            process.exit(1);
        }
    }
}

async function openPr(): Promise<void> {
    try {
        await execAsync('gh pr view --web');
    } catch {
        console.error(chalk.red('Error:'), 'No PR found for current branch');
        process.exit(1);
    }
}

async function showPrStatus(issueNumber: number | null): Promise<void> {
    try {
        const { stdout } = await execAsync('gh pr status');
        console.log(stdout);
    } catch (error: unknown) {
        const err = error as { stderr?: string };
        console.error(chalk.red('Error:'), err.stderr || 'Failed to get PR status');
        process.exit(1);
    }
}

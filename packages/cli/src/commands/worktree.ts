/**
 * Worktree management commands for ghp CLI.
 */

import chalk from 'chalk';
import { api } from '../github-api.js';
import {
    detectRepository,
    listWorktrees,
    removeWorktree,
} from '../git-utils.js';
import { getBranchForIssue } from '../branch-linker.js';
import { confirmWithDefault, isInteractive } from '../prompts.js';

interface WorktreeRemoveOptions {
    force?: boolean;
}

/**
 * Remove worktree for an issue
 */
export async function worktreeRemoveCommand(
    issue: string,
    options: WorktreeRemoveOptions = {}
): Promise<void> {
    const issueNumber = parseInt(issue, 10);
    if (isNaN(issueNumber)) {
        console.error(chalk.red('Error:'), 'Issue must be a number');
        process.exit(1);
    }

    // Detect repository
    const repo = await detectRepository();
    if (!repo) {
        console.error(chalk.red('Error:'), 'Not in a git repository with a GitHub remote');
        process.exit(1);
    }

    // Authenticate (needed for branch linker)
    const authenticated = await api.authenticate();
    if (!authenticated) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run', chalk.cyan('ghp auth'));
        process.exit(1);
    }

    // Find linked branch
    const branchName = await getBranchForIssue(repo, issueNumber);
    if (!branchName) {
        console.error(chalk.red('Error:'), `No branch linked to issue #${issueNumber}`);
        process.exit(1);
    }

    // Find worktree for this branch
    const worktrees = await listWorktrees();
    const worktree = worktrees.find(wt => wt.branch === branchName && !wt.isMain);

    if (!worktree) {
        console.log(chalk.yellow('No worktree found for issue'), `#${issueNumber}`);
        return;
    }

    console.log(chalk.dim('Found worktree:'), worktree.path);

    // Confirm removal unless --force
    if (!options.force && isInteractive()) {
        const confirmed = await confirmWithDefault(
            `Remove worktree at ${worktree.path}?`,
            true
        );
        if (!confirmed) {
            console.log('Aborted.');
            return;
        }
    }

    // Remove the worktree
    try {
        await removeWorktree(worktree.path, {}, options.force);
        console.log(chalk.green('✓'), `Removed worktree: ${worktree.path}`);
    } catch (error) {
        if (options.force) {
            console.error(chalk.red('Error:'), 'Failed to remove worktree:', error);
        } else {
            console.error(chalk.red('Error:'), 'Failed to remove worktree.');
            console.log(chalk.dim('You may have uncommitted changes. Use --force to remove anyway.'));
        }
        process.exit(1);
    }
}

/**
 * List all worktrees
 */
export async function worktreeListCommand(): Promise<void> {
    // Detect repository
    const repo = await detectRepository();
    if (!repo) {
        console.error(chalk.red('Error:'), 'Not in a git repository with a GitHub remote');
        process.exit(1);
    }

    // Authenticate (needed for branch linker)
    await api.authenticate();

    const worktrees = await listWorktrees();

    if (worktrees.length === 0) {
        console.log(chalk.yellow('No worktrees found'));
        return;
    }

    console.log(chalk.bold('Worktrees:\n'));

    for (const wt of worktrees) {
        const isMain = wt.isMain ? chalk.dim(' (main)') : '';
        const branch = wt.branch || chalk.dim('(detached)');

        // Try to find issue number from branch
        let issueInfo = '';
        if (wt.branch && repo) {
            const match = wt.branch.match(/\/(\d+)[-_]/);
            if (match) {
                issueInfo = chalk.cyan(` #${match[1]}`);
            }
        }

        console.log(`  ${chalk.green(wt.path)}${isMain}`);
        console.log(`    Branch: ${branch}${issueInfo}`);
        console.log();
    }
}

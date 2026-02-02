import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository, listWorktrees, removeWorktree, GitError } from '../git-utils.js';
import { removeActiveLabelSafely } from '../active-label.js';
import { getBranchForIssue, unlinkBranch } from '../branch-linker.js';

interface StopOptions {
    unlink?: boolean;
    worktree?: boolean;
}

export async function stopCommand(issue: string, options: StopOptions): Promise<void> {
    const issueNumber = parseInt(issue, 10);
    if (isNaN(issueNumber)) {
        console.error(chalk.red('Error:'), 'Issue must be a number');
        process.exit(1);
    }

    // Detect repository
    let repo;
    try {
        repo = await detectRepository();
    } catch (error) {
        if (error instanceof GitError) {
            console.error(chalk.red('Error:'), 'Git command failed:', error.stderr || error.message);
        } else {
            console.error(chalk.red('Error:'), 'Failed to detect repository');
        }
        process.exit(1);
    }
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

    // Find the item to verify it exists
    const item = await api.findItemByNumber(repo, issueNumber);
    if (!item) {
        console.error(chalk.red('Error:'), `Issue #${issueNumber} not found in any project`);
        process.exit(1);
    }

    console.log(chalk.blue('Stopping work on:'), item.title);

    // Remove active label from this issue
    await removeActiveLabelSafely(repo, issueNumber, false);

    // Get the linked branch for potential operations
    const branchName = await getBranchForIssue(repo, issueNumber);

    // Handle --unlink flag: remove branch link from issue
    if (options.unlink) {
        if (branchName) {
            const unlinked = await unlinkBranch(repo, issueNumber);
            if (unlinked) {
                console.log(chalk.green('✓'), 'Unlinked branch from issue');
            } else {
                console.log(chalk.yellow('⚠'), 'No branch link to remove');
            }
        } else {
            console.log(chalk.dim('No branch linked to this issue'));
        }
    }

    // Handle --worktree flag: remove the worktree if it exists
    if (options.worktree) {
        if (branchName) {
            const worktrees = await listWorktrees();
            const worktree = worktrees.find(wt => wt.branch === branchName && !wt.isMain);

            if (worktree) {
                try {
                    await removeWorktree(worktree.path);
                    console.log(chalk.green('✓'), 'Removed worktree:', worktree.path);
                } catch (error) {
                    console.log(chalk.yellow('⚠'), 'Could not remove worktree');
                    if (error instanceof GitError) {
                        // Provide specific guidance based on the error
                        if (error.stderr.includes('uncommitted changes') || error.stderr.includes('modified files')) {
                            console.log(chalk.dim('Reason: Uncommitted changes in worktree'));
                        } else {
                            console.log(chalk.dim(`Git error: ${error.stderr.trim()}`));
                        }
                    }
                    console.log(chalk.dim('Run:'), `git worktree remove --force "${worktree.path}"`);
                }
            } else {
                console.log(chalk.dim('No worktree found for this issue'));
            }
        } else {
            console.log(chalk.dim('No branch linked to this issue'));
        }
    }

    console.log(chalk.green('✓'), 'Stopped work on issue');
}

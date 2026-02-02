import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository, listWorktrees, removeWorktree, GitError } from '../git-utils.js';
import { getConfig } from '../config.js';
import { removeActiveLabelSafely } from '../active-label.js';
import { getBranchForIssue } from '../branch-linker.js';
import { confirmWithDefault, isInteractive } from '../prompts.js';
import { exit } from '../exit.js';

export async function doneCommand(issue: string): Promise<void> {
    const issueNumber = parseInt(issue, 10);
    if (isNaN(issueNumber)) {
        console.error(chalk.red('Error:'), 'Issue must be a number');
        exit(1);
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
        exit(1);
    }
    if (!repo) {
        console.error(chalk.red('Error:'), 'Not in a git repository with a GitHub remote');
        exit(1);
    }

    // Authenticate
    const authenticated = await api.authenticate();
    if (!authenticated) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run', chalk.cyan('ghp auth'));
        exit(1);
    }

    // Find the item
    const item = await api.findItemByNumber(repo, issueNumber);
    if (!item) {
        console.error(chalk.red('Error:'), `Issue #${issueNumber} not found in any project`);
        exit(1);
    }

    const targetStatus = getConfig('doneStatus');
    
    if (item.status === targetStatus) {
        console.log(chalk.yellow('Already done:'), item.title);
        return;
    }

    const statusField = await api.getStatusField(item.projectId);
    if (!statusField) {
        console.error(chalk.red('Error:'), 'Could not find Status field in project');
        exit(1);
    }

    const option = statusField.options.find(o => o.name === targetStatus);
    if (!option) {
        console.error(chalk.red('Error:'), `Status "${targetStatus}" not found in project`);
        console.log('Available:', statusField.options.map(o => o.name).join(', '));
        exit(1);
    }

    const success = await api.updateItemStatus(
        item.projectId,
        item.id,
        statusField.fieldId,
        option.id
    );

    if (success) {
        console.log(chalk.green('✓'), `Marked as done: ${item.title}`);

        // Remove active label from this issue (but protect other worktree issues)
        await removeActiveLabelSafely(repo, issueNumber, true);

        // Check if this issue has a worktree and offer to remove it
        const branchName = await getBranchForIssue(repo, issueNumber);
        if (branchName) {
            const worktrees = await listWorktrees();
            const worktree = worktrees.find(wt => wt.branch === branchName && !wt.isMain);

            if (worktree && isInteractive()) {
                console.log();
                console.log(chalk.dim('Found worktree:'), worktree.path);

                const shouldRemove = await confirmWithDefault(
                    'Remove worktree?',
                    true
                );

                if (shouldRemove) {
                    try {
                        await removeWorktree(worktree.path);
                        console.log(chalk.green('✓'), 'Removed worktree');
                    } catch (error) {
                        console.log(chalk.yellow('⚠'), 'Could not remove worktree');
                        if (error instanceof GitError) {
                            if (error.stderr.includes('uncommitted changes') || error.stderr.includes('modified files')) {
                                console.log(chalk.dim('Reason: Uncommitted changes in worktree'));
                            } else {
                                console.log(chalk.dim(`Git error: ${error.stderr.trim()}`));
                            }
                        }
                        console.log(chalk.dim('Run:'), `git worktree remove --force "${worktree.path}"`);
                    }
                }
            }
        }
    } else {
        console.error(chalk.red('Error:'), 'Failed to update status');
        exit(1);
    }
}

/**
 * Worktree management commands for ghp CLI.
 */

import chalk from 'chalk';
import { api } from '../github-api.js';
import {
    detectRepository,
    listWorktrees,
} from '../git-utils.js';
import { getBranchForIssue } from '../branch-linker.js';
import { confirmWithDefault, isInteractive } from '../prompts.js';
import {
    removeWorktreeWorkflow,
    type HookResult,
} from '@bretwardjames/ghp-core';
import { exit } from '../exit.js';
import { getHooksConfig } from '../config.js';

interface WorktreeRemoveOptions {
    force?: boolean;
}

interface WorktreeListOptions {
    json?: boolean;
}

/**
 * Display hook results in CLI format
 */
function displayHookResults(results: HookResult[], eventName: string): void {
    if (results.length === 0) return;

    console.log(chalk.dim(`Running ${eventName} hooks...`));

    for (const result of results) {
        if (result.success) {
            console.log(chalk.green('✓'), `Hook "${result.hookName}" completed`);
            if (result.output) {
                const lines = result.output.split('\n').slice(0, 3);
                for (const line of lines) {
                    console.log(chalk.dim(`  ${line}`));
                }
                if (result.output.split('\n').length > 3) {
                    console.log(chalk.dim('  ...'));
                }
            }
        } else {
            console.log(chalk.yellow('⚠'), `Hook "${result.hookName}" failed`);
            if (result.error) {
                console.log(chalk.dim(`  ${result.error}`));
            }
        }
    }
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
        exit(1);
    }

    // Detect repository
    const repo = await detectRepository();
    if (!repo) {
        console.error(chalk.red('Error:'), 'Not in a git repository with a GitHub remote');
        exit(1);
    }

    // Authenticate (needed for branch linker)
    const authenticated = await api.authenticate();
    if (!authenticated) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run', chalk.cyan('ghp auth'));
        exit(1);
    }

    // Find linked branch
    const branchName = await getBranchForIssue(repo, issueNumber);
    if (!branchName) {
        console.error(chalk.red('Error:'), `No branch linked to issue #${issueNumber}`);
        exit(1);
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

    // Use the workflow to remove worktree and fire hooks
    const hooksConfig = getHooksConfig();
    const result = await removeWorktreeWorkflow({
        repo,
        issueNumber,
        branch: branchName,
        worktreePath: worktree.path,
        force: options.force,
        onFailure: hooksConfig.onFailure,
    });

    if (!result.success) {
        if (options.force) {
            console.error(chalk.red('Error:'), 'Failed to remove worktree:', result.error);
        } else {
            console.error(chalk.red('Error:'), 'Failed to remove worktree.');
            console.log(chalk.dim('You may have uncommitted changes. Use --force to remove anyway.'));
        }
        exit(1);
    }

    console.log(chalk.green('✓'), `Removed worktree: ${result.worktree?.path}`);

    // Display hook results
    if (result.hookResults.length > 0) {
        console.log();
        displayHookResults(result.hookResults, 'worktree-removed');
    }
}

/**
 * List all worktrees
 */
export async function worktreeListCommand(options: WorktreeListOptions = {}): Promise<void> {
    // Detect repository
    const repo = await detectRepository();
    if (!repo) {
        console.error(chalk.red('Error:'), 'Not in a git repository with a GitHub remote');
        exit(1);
    }

    // Authenticate (needed for branch linker)
    await api.authenticate();

    const worktrees = await listWorktrees();

    if (worktrees.length === 0) {
        if (options.json) {
            console.log('[]');
        } else {
            console.log(chalk.yellow('No worktrees found'));
        }
        return;
    }

    // JSON output
    if (options.json) {
        const jsonOutput = worktrees.map(wt => {
            // Extract issue number from branch name
            let issueNumber: number | null = null;
            if (wt.branch) {
                const match = wt.branch.match(/\/(\d+)[-_]/);
                if (match) {
                    issueNumber = parseInt(match[1], 10);
                }
            }
            return {
                path: wt.path,
                branch: wt.branch || null,
                issueNumber,
                isMain: wt.isMain,
            };
        });
        console.log(JSON.stringify(jsonOutput, null, 2));
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

import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { detectRepository, removeWorktree } from '../git-utils.js';
import { api } from '../github-api.js';
import { getBranchWorktree } from '../worktree-utils.js';
import { confirmWithDefault, isInteractive } from '../prompts.js';
import { getHooksConfig } from '../config.js';
import {
    executeHooksForEvent,
    hasHooksForEvent,
    extractIssueNumberFromBranch,
    type PrMergedPayload,
    type WorktreeRemovedPayload,
} from '@bretwardjames/ghp-core';
import { exit } from '../exit.js';

const execAsync = promisify(exec);

interface MergeOptions {
    squash?: boolean;
    rebase?: boolean;
    deleteBranch?: boolean;
    auto?: boolean;
    autoClean?: boolean;
}

interface PrInfo {
    number: number;
    title: string;
    url: string;
    headRefName: string;
    baseRefName: string;
    state: string;
}

/**
 * Get PR info for the current branch or specified PR number
 */
async function getPrInfo(prNumber?: number): Promise<PrInfo | null> {
    try {
        const prArg = prNumber ? String(prNumber) : '';
        const { stdout } = await execAsync(
            `gh pr view ${prArg} --json number,title,url,headRefName,baseRefName,state`
        );
        return JSON.parse(stdout) as PrInfo;
    } catch {
        return null;
    }
}

/**
 * Build merge flags from options
 */
function buildMergeFlags(options: MergeOptions): string[] {
    const flags: string[] = [];

    if (options.squash) {
        flags.push('--squash');
    } else if (options.rebase) {
        flags.push('--rebase');
    }

    // --delete-branch is true by default (can be disabled with --no-delete-branch)
    if (options.deleteBranch !== false) {
        flags.push('--delete-branch');
    }

    if (options.auto) {
        flags.push('--auto');
    }

    return flags;
}

/**
 * Merge a PR and fire the pr-merged hook
 */
export async function mergeCommand(prNumber: string | undefined, options: MergeOptions): Promise<void> {
    // Detect repository
    const repo = await detectRepository();
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

    // Parse PR number if provided
    const parsedPrNumber = prNumber ? parseInt(prNumber, 10) : undefined;
    if (prNumber && isNaN(parsedPrNumber!)) {
        console.error(chalk.red('Error:'), 'PR number must be a valid number');
        exit(1);
    }

    // Get PR info
    console.log(chalk.dim('Looking up PR...'));
    const prInfo = await getPrInfo(parsedPrNumber);

    if (!prInfo) {
        if (parsedPrNumber) {
            console.error(chalk.red('Error:'), `PR #${parsedPrNumber} not found`);
        } else {
            console.error(chalk.red('Error:'), 'No PR found for current branch');
            console.log(chalk.dim('Tip: Specify a PR number explicitly: ghp merge 123'));
        }
        exit(1);
    }

    if (prInfo.state !== 'OPEN') {
        console.error(chalk.red('Error:'), `PR #${prInfo.number} is not open (state: ${prInfo.state})`);
        exit(1);
    }

    console.log(chalk.green('Found PR:'), `#${prInfo.number} - ${prInfo.title}`);
    console.log(chalk.dim(`Branch: ${prInfo.headRefName} → ${prInfo.baseRefName}`));

    // Track if we removed a worktree (for firing hook after merge)
    let removedWorktree: { path: string; name: string } | null = null;

    // Check for worktree using this branch (only if --delete-branch is enabled)
    if (options.deleteBranch !== false) {
        const worktree = await getBranchWorktree(prInfo.headRefName);

        if (worktree) {
            console.log();
            console.log(chalk.yellow('Warning:'), `Branch is in use by worktree at ${worktree.path}`);

            // Prompt to remove worktree (unless --auto-clean)
            let shouldRemove = options.autoClean === true;

            if (!shouldRemove && isInteractive()) {
                shouldRemove = await confirmWithDefault(
                    'Remove worktree and delete branch?',
                    true
                );
            } else if (!shouldRemove) {
                // Non-interactive without --auto-clean: abort
                console.error(chalk.red('Error:'), 'Cannot delete branch while worktree exists');
                console.log(chalk.dim('Use --auto-clean to automatically remove the worktree'));
                console.log(chalk.dim('Or use --no-delete-branch to keep the branch'));
                exit(1);
            }

            if (!shouldRemove) {
                console.log('Aborted.');
                exit(0);
            }

            // Remove the worktree
            const worktreePath = worktree.path;
            const worktreeName = worktreePath.split('/').pop() || '';

            console.log(chalk.dim('Removing worktree...'));
            try {
                await removeWorktree(worktreePath, {}, true); // force removal
                console.log(chalk.green('✓'), `Removed worktree: ${worktreePath}`);
                removedWorktree = { path: worktreePath, name: worktreeName };
            } catch (error) {
                console.error(chalk.red('Error:'), 'Failed to remove worktree:', error);
                exit(1);
            }
        }
    }

    // Build merge command
    const flags = buildMergeFlags(options);
    const mergeCmd = `gh pr merge ${prInfo.number} ${flags.join(' ')}`;

    console.log();
    console.log(chalk.dim(`Running: ${mergeCmd}`));

    try {
        const { stdout, stderr } = await execAsync(mergeCmd);
        if (stdout) console.log(stdout);
        if (stderr) console.log(chalk.dim(stderr));

        console.log(chalk.green('✓'), `PR #${prInfo.number} merged successfully`);
    } catch (error: unknown) {
        const err = error as { stderr?: string; message?: string };
        console.error(chalk.red('Error:'), 'Failed to merge PR');
        if (err.stderr) console.error(chalk.dim(err.stderr));
        exit(1);
    }

    // Load hooks config once for all hooks
    const hooksConfig = getHooksConfig();

    // Fire worktree-removed hook if we removed a worktree
    if (removedWorktree && hasHooksForEvent('worktree-removed')) {
        console.log();
        console.log(chalk.dim('Running worktree-removed hooks...'));

        const issueNumber = extractIssueNumberFromBranch(prInfo.headRefName);
        const worktreePayload: WorktreeRemovedPayload = {
            repo: `${repo.owner}/${repo.name}`,
            issue: issueNumber ? {
                number: issueNumber,
                title: prInfo.title, // Use PR title as proxy
                url: `https://github.com/${repo.owner}/${repo.name}/issues/${issueNumber}`,
            } : undefined,
            branch: prInfo.headRefName,
            worktree: removedWorktree,
        };

        const worktreeResults = await executeHooksForEvent('worktree-removed', worktreePayload, {
            onFailure: hooksConfig.onFailure,
        });

        for (const result of worktreeResults) {
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

    // Fire pr-merged hook
    if (hasHooksForEvent('pr-merged')) {
        console.log();
        console.log(chalk.dim('Running pr-merged hooks...'));

        const payload: PrMergedPayload = {
            repo: `${repo.owner}/${repo.name}`,
            pr: {
                number: prInfo.number,
                title: prInfo.title,
                url: prInfo.url,
                merged_at: new Date().toISOString(),
            },
            branch: prInfo.headRefName,
            base: prInfo.baseRefName,
        };

        const results = await executeHooksForEvent('pr-merged', payload, {
            onFailure: hooksConfig.onFailure,
        });

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
}

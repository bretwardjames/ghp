import chalk from 'chalk';
import { api } from '../github-api.js';
import {
    detectRepository,
    checkoutBranch,
    branchExists,
    getCurrentBranch,
} from '../git-utils.js';
import { getBranchForIssue } from '../branch-linker.js';
import { applyActiveLabel } from '../active-label.js';
import { promptSelectWithDefault, isInteractive } from '../prompts.js';
import { createParallelWorktree, getBranchWorktree } from '../worktree-utils.js';

interface SwitchOptions {
    /** Create worktree instead of switching branches (parallel work mode) */
    parallel?: boolean;
    /** Custom path for parallel worktree */
    worktreePath?: string;
}

export async function switchCommand(issue: string, options: SwitchOptions = {}): Promise<void> {
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

    // Authenticate (needed to read issue body)
    const authenticated = await api.authenticate();
    if (!authenticated) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run', chalk.cyan('ghp auth'));
        process.exit(1);
    }

    // Find linked branch
    const branchName = await getBranchForIssue(repo, issueNumber);
    if (!branchName) {
        console.error(chalk.red('Error:'), `No branch linked to issue #${issueNumber}`);
        console.log(chalk.dim('Use'), chalk.cyan(`ghp link-branch ${issueNumber}`), chalk.dim('to link a branch'));
        process.exit(1);
    }

    // Check if branch exists
    if (!(await branchExists(branchName))) {
        console.error(chalk.red('Error:'), `Branch "${branchName}" no longer exists`);
        process.exit(1);
    }

    // Track if we're in parallel mode
    let isParallelMode = options.parallel === true;
    let worktreePath: string | undefined;

    // Check if already on that branch
    const currentBranch = await getCurrentBranch();
    const alreadyOnBranch = currentBranch === branchName;

    if (alreadyOnBranch && !options.parallel) {
        console.log(chalk.yellow('Already on branch:'), branchName);
        // Still apply the active label
        await applyActiveLabel(repo, issueNumber, true);
        return;
    }

    // Determine work mode: switch or parallel
    let workMode: 'switch' | 'parallel' = 'switch';

    if (options.parallel) {
        workMode = 'parallel';
    } else if (isInteractive()) {
        // Interactive: ask user how they want to work
        const choices = [
            'Switch to branch (default)',
            'Create parallel worktree (stay here, work in new directory)',
        ];
        const choice = await promptSelectWithDefault(
            'How would you like to work on this issue?',
            choices,
            0 // default: switch
        );
        if (choice === 1) {
            workMode = 'parallel';
            isParallelMode = true;
        }
    }

    if (workMode === 'parallel') {
        // ─────────────────────────────────────────────────────────────────────
        // Parallel mode: create worktree
        // ─────────────────────────────────────────────────────────────────────
        const result = await createParallelWorktree(
            repo,
            issueNumber,
            branchName,
            options.worktreePath
        );
        if (!result.success) {
            console.error(chalk.red('Error:'), result.error);
            process.exit(1);
        }
        worktreePath = result.path;
    } else {
        // ─────────────────────────────────────────────────────────────────────
        // Switch mode: checkout the branch
        // ─────────────────────────────────────────────────────────────────────

        // Check if branch is already in a worktree
        const existingWorktree = await getBranchWorktree(branchName);
        if (existingWorktree) {
            console.log(chalk.yellow('Branch is in a worktree:'), existingWorktree.path);
            console.log(chalk.dim('Run:'), `cd ${existingWorktree.path}`);
            worktreePath = existingWorktree.path;
            isParallelMode = true; // Treat as parallel for label handling
        } else {
            try {
                await checkoutBranch(branchName);
                console.log(chalk.green('✓'), `Switched to branch: ${branchName}`);
            } catch (error) {
                console.error(chalk.red('Error:'), 'Failed to switch branch:', error);
                process.exit(1);
            }
        }
    }

    // Update active label (non-exclusive in parallel mode)
    await applyActiveLabel(repo, issueNumber, !isParallelMode);

    // Show path info for parallel worktree
    if (isParallelMode && worktreePath) {
        console.log();
        console.log(chalk.cyan('Worktree at:'), worktreePath);
        console.log(chalk.dim('Run:'), `cd ${worktreePath}`);
    }
}

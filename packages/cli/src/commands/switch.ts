import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, copyFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { api } from '../github-api.js';
import {
    detectRepository,
    checkoutBranch,
    branchExists,
    getCurrentBranch,
    createWorktree,
    generateWorktreePath,
    getWorktreeForBranch,
    getRepositoryRoot,
} from '../git-utils.js';
import { getBranchForIssue } from '../branch-linker.js';
import { getWorktreeConfig, getConfig } from '../config.js';
import { applyActiveLabel } from '../active-label.js';
import { promptSelectWithDefault, isInteractive } from '../prompts.js';

const execAsync = promisify(exec);

interface SwitchOptions {
    /** Create worktree instead of switching branches (parallel work mode) */
    parallel?: boolean;
    /** Custom path for parallel worktree */
    worktreePath?: string;
}

/**
 * Setup a worktree for parallel work: copy configured files and run setup command.
 */
async function setupWorktree(worktreePath: string, sourcePath: string): Promise<void> {
    const config = getWorktreeConfig();

    // Copy configured files
    for (const file of config.copyFiles) {
        const srcFile = join(sourcePath, file);
        const destFile = join(worktreePath, file);

        if (existsSync(srcFile)) {
            const destDir = dirname(destFile);
            if (!existsSync(destDir)) {
                mkdirSync(destDir, { recursive: true });
            }
            copyFileSync(srcFile, destFile);
            console.log(chalk.dim(`  Copied ${file}`));
        }
    }

    // Run setup command if enabled
    if (config.autoSetup && config.setupCommand) {
        console.log(chalk.dim(`  Running: ${config.setupCommand}`));
        try {
            await execAsync(config.setupCommand, { cwd: worktreePath });
            console.log(chalk.green('✓'), 'Setup complete');
        } catch (error) {
            console.log(chalk.yellow('⚠'), 'Setup command failed (you may need to run it manually)');
        }
    }
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
        const config = getWorktreeConfig();
        const repoRoot = await getRepositoryRoot();

        if (!repoRoot) {
            console.error(chalk.red('Error:'), 'Could not determine repository root');
            process.exit(1);
        }

        // Generate worktree path
        const wtPath = options.worktreePath || generateWorktreePath(config.path, repo.name, issueNumber);

        // Check if worktree already exists for this branch
        const existingWorktree = await getWorktreeForBranch(branchName);
        if (existingWorktree && !existingWorktree.isMain) {
            // Non-main worktree already exists
            console.log(chalk.yellow('Worktree already exists:'), existingWorktree.path);
            worktreePath = existingWorktree.path;
        } else {
            // If branch is checked out in main, switch main to default branch first
            if (existingWorktree?.isMain) {
                const mainBranch = getConfig('mainBranch') || 'main';
                console.log(chalk.yellow('Note:'), `Branch "${branchName}" is currently checked out in main repo.`);
                console.log(chalk.dim('Switching main repo to default branch before creating worktree...'));
                await checkoutBranch(mainBranch);
                console.log(chalk.green('✓'), `Switched main repo to ${mainBranch}`);
            }
            // Ensure parent directory exists
            const parentDir = dirname(wtPath);
            if (!existsSync(parentDir)) {
                mkdirSync(parentDir, { recursive: true });
            }

            console.log(chalk.dim('Creating worktree for'), `#${issueNumber}...`);

            // Create the worktree
            await createWorktree(wtPath, branchName);
            console.log(chalk.green('✓'), `Created worktree: ${wtPath}`);

            // Setup the worktree
            await setupWorktree(wtPath, repoRoot);
            worktreePath = wtPath;
        }
    } else {
        // ─────────────────────────────────────────────────────────────────────
        // Switch mode: checkout the branch
        // ─────────────────────────────────────────────────────────────────────
        try {
            await checkoutBranch(branchName);
            console.log(chalk.green('✓'), `Switched to branch: ${branchName}`);
        } catch (error) {
            console.error(chalk.red('Error:'), 'Failed to switch branch:', error);
            process.exit(1);
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

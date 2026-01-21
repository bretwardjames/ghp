import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, copyFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { api } from '../github-api.js';
import {
    detectRepository,
    getCurrentBranch,
    hasUncommittedChanges,
    branchExists,
    createBranch,
    checkoutBranch,
    getCommitsBehind,
    pullLatest,
    generateBranchName,
    getAllBranches,
    createWorktree,
    generateWorktreePath,
    getWorktreeForBranch,
    getRepositoryRoot,
    type RepoInfo,
} from '../git-utils.js';
import { getConfig, getWorktreeConfig } from '../config.js';
import { linkBranch, getBranchForIssue } from '../branch-linker.js';
import { confirmWithDefault, promptSelectWithDefault, isInteractive } from '../prompts.js';
import { applyActiveLabel } from '../active-label.js';

const execAsync = promisify(exec);

/** Assignment action for non-interactive mode */
export type AssignAction = 'reassign' | 'add' | 'skip';

/** Branch action for non-interactive mode */
export type BranchAction = 'create' | 'link' | 'skip';

/** Work mode for the start command */
export type WorkMode = 'switch' | 'parallel';

interface StartOptions {
    branch?: boolean;
    status?: boolean;
    // Non-interactive flags
    assign?: AssignAction;
    branchAction?: BranchAction;
    fromMain?: boolean;
    /** Use default values for all prompts (non-interactive mode) */
    forceDefaults?: boolean;
    force?: boolean;
    /** Create worktree instead of switching branches (parallel work mode) */
    parallel?: boolean;
    /** Custom path for parallel worktree */
    worktreePath?: string;
}

/**
 * Handle uncommitted changes - prompt user to continue or abort.
 * Returns true if we should proceed.
 * @param force - If true, proceed without prompting
 * @param forceDefaults - If true, accept the default (continue) without prompting
 */
async function handleUncommittedChanges(force?: boolean, forceDefaults?: boolean): Promise<boolean> {
    if (await hasUncommittedChanges()) {
        console.log(chalk.yellow('Warning:'), 'You have uncommitted changes.');

        // --force flag bypasses the check entirely
        if (force) {
            console.log(chalk.dim('[--force] Proceeding with uncommitted changes'));
            return true;
        }

        const shouldContinue = await confirmWithDefault(
            'Continue anyway?',
            false, // default is to abort
            forceDefaults // --force-defaults flag overrides to true
        );

        if (!shouldContinue) {
            console.log('Aborted.');
            return false;
        }
    }
    return true;
}

/**
 * Setup a worktree for parallel work: copy configured files and run setup command.
 *
 * @param worktreePath - Path to the newly created worktree
 * @param sourcePath - Path to the source repository (to copy files from)
 */
async function setupWorktree(worktreePath: string, sourcePath: string): Promise<void> {
    const config = getWorktreeConfig();

    // Copy configured files
    for (const file of config.copyFiles) {
        const srcFile = join(sourcePath, file);
        const destFile = join(worktreePath, file);

        if (existsSync(srcFile)) {
            // Ensure destination directory exists
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
            if (error instanceof Error) {
                console.log(chalk.dim(`  Error: ${error.message}`));
            }
        }
    }
}

/**
 * Create a parallel worktree for an issue and set it up.
 * Returns the path to the created worktree.
 */
async function createParallelWorktree(
    repo: RepoInfo,
    issueNumber: number,
    branchName: string,
    customPath?: string
): Promise<string> {
    const config = getWorktreeConfig();
    const repoRoot = await getRepositoryRoot();

    if (!repoRoot) {
        throw new Error('Could not determine repository root');
    }

    // Generate worktree path
    const wtPath = customPath || generateWorktreePath(config.path, repo.name, issueNumber);

    // Check if worktree already exists for this branch
    const existingWorktree = await getWorktreeForBranch(branchName);
    if (existingWorktree) {
        if (existingWorktree.isMain) {
            // Branch is checked out in main repo - can't create parallel worktree
            // Git doesn't allow a branch to be checked out in multiple worktrees
            console.log(chalk.yellow('Note:'), `Branch "${branchName}" is currently checked out in main repo.`);
            console.log(chalk.dim('Switching main repo to default branch before creating worktree...'));

            // Switch main repo to default branch first
            const mainBranch = getConfig('mainBranch') || 'main';
            await checkoutBranch(mainBranch);
            console.log(chalk.green('✓'), `Switched main repo to ${mainBranch}`);
        } else {
            // Non-main worktree already exists
            console.log(chalk.yellow('Worktree already exists:'), existingWorktree.path);
            return existingWorktree.path;
        }
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

    // Setup the worktree (copy files, run setup command)
    await setupWorktree(wtPath, repoRoot);

    return wtPath;
}

/**
 * Create a new branch, push it, and link it to the issue.
 * @param forceDefaults - If true, accept defaults without prompting
 */
async function createAndLinkBranch(
    repo: RepoInfo,
    item: { number?: number | null; title: string },
    branchPattern: string,
    forceDefaults?: boolean
): Promise<string> {
    const branchName = generateBranchName(branchPattern, {
        user: api.username || 'user',
        number: item.number ?? null,
        title: item.title,
        repo: repo.name,
    });

    // Check if branch exists
    if (await branchExists(branchName)) {
        console.log(chalk.yellow('Branch already exists:'), branchName);
        const shouldCheckout = await confirmWithDefault(
            'Checkout existing branch?',
            true, // default is to proceed
            forceDefaults   // --force-defaults flag
        );
        if (shouldCheckout) {
            await checkoutBranch(branchName);
            console.log(chalk.green('✓'), `Switched to ${branchName}`);
        }
    } else {
        // Create branch
        try {
            await createBranch(branchName);
            console.log(chalk.green('✓'), `Created branch: ${branchName}`);

            // Create empty commit linking to issue and push
            const commitMsg = `Start work on #${item.number}\n\n${item.title}`;
            await execAsync(`git commit --allow-empty -m "${commitMsg.replace(/"/g, '\\"')}"`);
            console.log(chalk.green('✓'), `Created linking commit for #${item.number}`);

            await execAsync(`git push -u origin ${branchName}`);
            console.log(chalk.green('✓'), `Pushed branch to origin`);
        } catch (error) {
            console.error(chalk.red('Error:'), 'Failed to create branch:', error);
            process.exit(1);
        }
    }

    // Link branch to issue
    if (item.number) {
        const linkSuccess = await linkBranch(repo, item.number, branchName);
        if (linkSuccess) {
            console.log(chalk.green('✓'), `Linked branch to #${item.number}`);
        } else {
            console.log(chalk.yellow('⚠'), `Could not link branch to issue`);
        }
    }

    return branchName;
}

/**
 * Unified start working command.
 *
 * Decision flow:
 * 1. Issue has linked branch → Checkout that branch (if not already on it), update status/label
 * 2. Issue NOT linked + on main → Offer: Create new branch OR Link existing branch
 * 3. Issue NOT linked + NOT on main → Offer: Switch to main & create, Create from current, Link existing
 */
export async function startCommand(issue: string, options: StartOptions): Promise<void> {
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

    // Authenticate
    const authenticated = await api.authenticate();
    if (!authenticated) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run', chalk.cyan('ghp auth'));
        process.exit(1);
    }

    // Find the item
    console.log(chalk.dim(`Looking for issue #${issueNumber}...`));
    const item = await api.findItemByNumber(repo, issueNumber);
    if (!item) {
        console.error(chalk.red('Error:'), `Issue #${issueNumber} not found in any project`);
        process.exit(1);
    }

    console.log(chalk.green('Found:'), item.title);
    console.log(chalk.dim(`Project: ${item.projectTitle} | Status: ${item.status || 'None'}`));
    console.log();

    // Check if current user is assigned
    const isAssigned = item.assignees.some(
        (a) => a.toLowerCase() === api.username?.toLowerCase()
    );

    if (!isAssigned) {
        console.log(chalk.yellow('You are not assigned to this issue.'));

        // Map --assign flag to choice index
        let forceIndex: number | undefined;
        if (options.assign === 'reassign') forceIndex = 0;
        else if (options.assign === 'add') forceIndex = 1;
        else if (options.assign === 'skip') forceIndex = 2;

        const choices = ['Reassign to me', 'Add me', 'Leave as is'];
        const choiceIdx = await promptSelectWithDefault(
            'What would you like to do?',
            choices,
            2, // default: skip (leave as is) for non-interactive
            forceIndex
        );

        if (choiceIdx === 0) {
            // Reassign to me
            const success = await api.updateAssignees(repo, issueNumber, [api.username!]);
            if (success) {
                console.log(chalk.green('✓'), `Reassigned to ${api.username}`);
            }
        } else if (choiceIdx === 1) {
            // Add me
            const newAssignees = [...item.assignees, api.username!];
            const success = await api.updateAssignees(repo, issueNumber, newAssignees);
            if (success) {
                console.log(chalk.green('✓'), `Added ${api.username} as assignee`);
            }
        }
        // Leave as is - do nothing
        console.log();
    }

    // Check if issue has linked branch
    const linkedBranch = await getBranchForIssue(repo, issueNumber);

    // Track if we're in parallel mode (for active label handling)
    let isParallelMode = options.parallel === true;
    let worktreePath: string | undefined;

    if (linkedBranch) {
        // ═══════════════════════════════════════════════════════════════════════
        // Issue already has a linked branch - offer switch or parallel worktree
        // ═══════════════════════════════════════════════════════════════════════
        const currentBranch = await getCurrentBranch();

        // Check if already on the branch
        if (currentBranch === linkedBranch && !options.parallel) {
            console.log(chalk.dim(`Already on branch: ${linkedBranch}`));
        } else {
            // Determine work mode: switch or parallel
            let workMode: WorkMode = 'switch';

            if (options.parallel) {
                workMode = 'parallel';
            } else if (isInteractive() && !options.forceDefaults) {
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
                // ─────────────────────────────────────────────────────────────────
                // Parallel mode: create worktree
                // ─────────────────────────────────────────────────────────────────
                worktreePath = await createParallelWorktree(
                    repo,
                    issueNumber,
                    linkedBranch,
                    options.worktreePath
                );
            } else {
                // ─────────────────────────────────────────────────────────────────
                // Switch mode: checkout the branch
                // ─────────────────────────────────────────────────────────────────

                // Check for uncommitted changes before switching
                if (!(await handleUncommittedChanges(options.force, options.forceDefaults))) {
                    process.exit(0);
                }

                // Check if branch exists locally
                if (await branchExists(linkedBranch)) {
                    await checkoutBranch(linkedBranch);
                    console.log(chalk.green('✓'), `Switched to branch: ${linkedBranch}`);
                } else {
                    // Try to checkout from remote
                    try {
                        await execAsync(`git fetch origin ${linkedBranch}`);
                        await execAsync(`git checkout -b ${linkedBranch} origin/${linkedBranch}`);
                        console.log(chalk.green('✓'), `Checked out branch from remote: ${linkedBranch}`);
                    } catch {
                        console.error(chalk.red('Error:'), `Branch "${linkedBranch}" no longer exists locally or remotely`);
                        console.log(chalk.dim('You may want to unlink and create a new branch.'));
                        process.exit(1);
                    }
                }
            }
        }
    } else if (options.branch !== false) {
        // ═══════════════════════════════════════════════════════════════════════
        // No linked branch - offer options based on current state
        // ═══════════════════════════════════════════════════════════════════════
        const mainBranch = getConfig('mainBranch') || 'main';
        const branchPattern = getConfig('branchPattern') || '{user}/{number}-{title}';
        const currentBranch = await getCurrentBranch();
        const isOnMain = currentBranch === mainBranch;

        console.log(chalk.yellow('No branch linked to this issue.'));

        // Check for uncommitted changes
        if (!(await handleUncommittedChanges(options.force, options.forceDefaults))) {
            process.exit(0);
        }

        if (isOnMain) {
            // On main - offer: create new or link existing

            // Map --branch-action flag to choice index
            let forceIndex: number | undefined;
            if (options.branchAction === 'create') forceIndex = 0;
            else if (options.branchAction === 'link') forceIndex = 1;
            else if (options.branchAction === 'skip') {
                // Skip branch creation entirely
                console.log(chalk.dim('[--branch-action=skip] Skipping branch creation'));
            }

            if (options.branchAction !== 'skip') {
                const choices = ['Create new branch (default)', 'Link existing branch'];
                const choice = await promptSelectWithDefault(
                    'What would you like to do?',
                    choices,
                    0, // default: create new branch for non-interactive
                    forceIndex
                );

                if (choice === 1) {
                    // Link existing branch
                    const branches = await getAllBranches();
                    const nonMainBranches = branches.filter(b => b !== mainBranch);

                    if (nonMainBranches.length === 0) {
                        console.log(chalk.yellow('No other branches to link.'));
                        process.exit(1);
                    }

                    // Sort by relevance to the issue
                    const sortedBranches = sortBranchesByRelevance(nonMainBranches, item.number, item.title);

                    // In non-interactive, pick the most relevant branch (index 0 after sorting)
                    const branchIdx = await promptSelectWithDefault(
                        'Select branch to link (sorted by relevance):',
                        sortedBranches,
                        0 // most relevant
                    );
                    const selectedBranch = sortedBranches[branchIdx];

                    const linkSuccess = await linkBranch(repo, issueNumber, selectedBranch);
                    if (linkSuccess) {
                        console.log(chalk.green('✓'), `Linked "${selectedBranch}" to #${issueNumber}`);
                    }

                    // Switch to that branch
                    await checkoutBranch(selectedBranch);
                    console.log(chalk.green('✓'), `Switched to branch: ${selectedBranch}`);
                } else {
                    // Create new branch from main
                    await handlePullIfBehind(mainBranch, options.forceDefaults);
                    await createAndLinkBranch(repo, item, branchPattern, options.forceDefaults);
                }
            }
        } else {
            // Not on main - offer: switch to main & create, create from current, or link existing

            // Map flags to choice index
            // --branch-action=create + --from-main → 0 (switch to main & create)
            // --branch-action=create + no --from-main → 1 (create from current)
            // --branch-action=link → 2
            // --branch-action=skip → skip entirely
            let forceIndex: number | undefined;
            if (options.branchAction === 'skip') {
                console.log(chalk.dim('[--branch-action=skip] Skipping branch creation'));
            } else if (options.branchAction === 'link') {
                forceIndex = 2;
            } else if (options.branchAction === 'create') {
                forceIndex = options.fromMain ? 0 : 1;
            } else if (!isInteractive()) {
                // Non-interactive default: switch to main & create (safest)
                forceIndex = 0;
            }

            if (options.branchAction !== 'skip') {
                const choices = [
                    `Switch to ${mainBranch} & create branch (default)`,
                    `Create branch from current (${currentBranch})`,
                    'Link existing branch',
                ];
                const choice = await promptSelectWithDefault(
                    'What would you like to do?',
                    choices,
                    0, // default: switch to main & create
                    forceIndex
                );

                if (choice === 2) {
                    // Link existing branch
                    const branches = await getAllBranches();
                    const nonMainBranches = branches.filter(b => b !== mainBranch);

                    if (nonMainBranches.length === 0) {
                        console.log(chalk.yellow('No other branches to link.'));
                        process.exit(1);
                    }

                    // Sort by relevance to the issue
                    const sortedBranches = sortBranchesByRelevance(nonMainBranches, item.number, item.title);

                    // In non-interactive, pick the most relevant branch (index 0 after sorting)
                    const branchIdx = await promptSelectWithDefault(
                        'Select branch to link (sorted by relevance):',
                        sortedBranches,
                        0 // most relevant
                    );
                    const selectedBranch = sortedBranches[branchIdx];

                    const linkSuccess = await linkBranch(repo, issueNumber, selectedBranch);
                    if (linkSuccess) {
                        console.log(chalk.green('✓'), `Linked "${selectedBranch}" to #${issueNumber}`);
                    }

                    // Switch to that branch if not already on it
                    if (currentBranch !== selectedBranch) {
                        await checkoutBranch(selectedBranch);
                        console.log(chalk.green('✓'), `Switched to branch: ${selectedBranch}`);
                    }
                } else if (choice === 1) {
                    // Create from current branch
                    await createAndLinkBranch(repo, item, branchPattern, options.forceDefaults);
                } else {
                    // Switch to main & create
                    await checkoutBranch(mainBranch);
                    console.log(chalk.green('✓'), `Switched to ${mainBranch}`);
                    await handlePullIfBehind(mainBranch, options.forceDefaults);
                    await createAndLinkBranch(repo, item, branchPattern, options.forceDefaults);
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Update status (unless --no-status)
    // ═══════════════════════════════════════════════════════════════════════════
    if (options.status !== false) {
        const targetStatus = getConfig('startWorkingStatus');
        if (targetStatus && item.status !== targetStatus) {
            const statusField = await api.getStatusField(item.projectId);
            if (statusField) {
                const option = statusField.options.find(o => o.name === targetStatus);
                if (option) {
                    const success = await api.updateItemStatus(
                        item.projectId,
                        item.id,
                        statusField.fieldId,
                        option.id
                    );
                    if (success) {
                        console.log(chalk.green('✓'), `Moved to "${targetStatus}"`);
                    } else {
                        console.log(chalk.yellow('Warning:'), `Failed to update status to "${targetStatus}"`);
                    }
                } else {
                    console.log(chalk.yellow('Warning:'), `Status "${targetStatus}" not found in project`);
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Apply active label
    // ═══════════════════════════════════════════════════════════════════════════
    // In parallel mode, don't remove label from other issues (non-exclusive)
    await applyActiveLabel(repo, issueNumber, !isParallelMode);

    console.log();
    console.log(chalk.green.bold('Ready to work on:'), item.title);

    // Show path info for parallel worktree
    if (isParallelMode && worktreePath) {
        console.log();
        console.log(chalk.cyan('Worktree created at:'), worktreePath);
        console.log(chalk.dim('Run:'), `cd ${worktreePath}`);
    }
}

/**
 * Sort branches by relevance to the issue.
 * Branches containing the issue number or title keywords are ranked higher.
 */
function sortBranchesByRelevance(branches: string[], issueNumber: number | null | undefined, title: string): string[] {
    const issueStr = issueNumber?.toString() || '';
    const titleWords = title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2); // Skip short words

    return [...branches].sort((a, b) => {
        const scoreA = getBranchRelevanceScore(a, issueStr, titleWords);
        const scoreB = getBranchRelevanceScore(b, issueStr, titleWords);
        return scoreB - scoreA; // Higher score first
    });
}

/**
 * Calculate a relevance score for a branch name.
 */
function getBranchRelevanceScore(branch: string, issueNumber: string, titleWords: string[]): number {
    const branchLower = branch.toLowerCase();
    let score = 0;

    // Strong match: issue number in branch name
    if (issueNumber && branch.includes(issueNumber)) {
        score += 100;
    }

    // Medium match: title words in branch name
    for (const word of titleWords) {
        if (branchLower.includes(word)) {
            score += 10;
        }
    }

    return score;
}

/**
 * Check if current branch is behind origin and offer to pull.
 * @param forceDefaults - If true, accept default (pull) without prompting
 */
async function handlePullIfBehind(branch: string, forceDefaults?: boolean): Promise<void> {
    const behind = await getCommitsBehind(branch);
    if (behind > 0) {
        console.log(chalk.yellow('Warning:'), `${branch} is ${behind} commit(s) behind origin.`);
        const shouldPull = await confirmWithDefault(
            'Pull latest?',
            true, // default is to proceed
            forceDefaults   // --force-defaults flag
        );
        if (shouldPull) {
            try {
                await pullLatest();
                console.log(chalk.green('✓'), 'Pulled latest changes');
            } catch (error) {
                console.error(chalk.red('Error:'), 'Failed to pull:', error);
                process.exit(1);
            }
        }
    }
}

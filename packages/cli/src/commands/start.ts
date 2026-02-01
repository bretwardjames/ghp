import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
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
    getWorktreeForBranch,
    type RepoInfo,
} from '../git-utils.js';
import { getConfig, getParallelWorkConfig, type TerminalMode } from '../config.js';
import { linkBranch, getBranchForIssue } from '../branch-linker.js';
import { confirmWithDefault, promptSelectWithDefault, isInteractive } from '../prompts.js';
import { applyActiveLabel } from '../active-label.js';
import { createParallelWorktree, getBranchWorktree } from '../worktree-utils.js';
import { openParallelWorkTerminal, openAdminPane, isInsideTmux } from '../terminal-utils.js';
import type { SubagentSpawnDirective } from '../types.js';
import {
    registerAgent,
    updateAgent,
    extractIssueNumberFromBranch,
    getAgentByIssue,
    executeHooksForEvent,
    hasHooksForEvent,
    type IssueStartedPayload,
    type WorktreeCreatedPayload,
} from '@bretwardjames/ghp-core';

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
    /** Review mode: skip status, label, and assignment changes */
    review?: boolean;
    /** Treat input as issue number (default in review mode: treat as PR number) */
    issue?: boolean;
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
    /** Whether to open a terminal (default: true with --parallel, set to false with --no-open) */
    open?: boolean;
    /** Whether to open the admin pane (ghp agents watch) in parallel mode */
    admin?: boolean;
    // Terminal mode overrides
    /** Use nvim with claudecode.nvim plugin */
    nvim?: boolean;
    /** Use claude CLI directly */
    claude?: boolean;
    /** Just open terminal, no Claude */
    terminalOnly?: boolean;
}

/**
 * Get terminal mode override from CLI options.
 * Returns undefined if no override specified (use config default).
 */
function getTerminalModeOverride(options: StartOptions): TerminalMode | undefined {
    if (options.nvim) return 'nvim-claude';
    if (options.claude) return 'claude';
    if (options.terminalOnly) return 'terminal';
    return undefined;
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
    let inputNumber = parseInt(issue, 10);
    if (isNaN(inputNumber)) {
        console.error(chalk.red('Error:'), 'Input must be a number');
        process.exit(1);
    }

    // In review mode, default to treating input as PR number (unless --issue flag)
    let issueNumber = inputNumber;

    if (options.review && !options.issue) {
        // Treat input as PR number - resolve to issue via branch name
        console.log(chalk.dim(`Looking up PR #${inputNumber}...`));
        try {
            const { stdout } = await execAsync(
                `gh pr view ${inputNumber} --json headRefName,number --jq '.headRefName'`
            );
            const prBranch = stdout.trim();
            if (!prBranch) {
                console.error(chalk.red('Error:'), `PR #${inputNumber} not found or has no branch`);
                process.exit(1);
            }

            // Extract issue number from branch name
            const extractedIssue = extractIssueNumberFromBranch(prBranch);
            if (!extractedIssue) {
                console.error(chalk.red('Error:'), `Could not extract issue number from branch: ${prBranch}`);
                console.log(chalk.dim('Use --issue flag to specify an issue number directly'));
                process.exit(1);
            }

            issueNumber = extractedIssue;
            console.log(chalk.dim(`PR #${inputNumber} → branch "${prBranch}" → issue #${issueNumber}`));
        } catch (error) {
            console.error(chalk.red('Error:'), `Failed to look up PR #${inputNumber}`);
            console.log(chalk.dim('Use --issue flag if you want to specify an issue number directly'));
            process.exit(1);
        }
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
    let item = await api.findItemByNumber(repo, issueNumber);

    if (!item) {
        // Issue not in any project - check if issue exists at all
        const issueDetails = await api.getIssueDetails(repo, issueNumber);
        if (!issueDetails) {
            console.error(chalk.red('Error:'), `Issue #${issueNumber} does not exist`);
            process.exit(1);
        }

        // Issue exists but not in project - handle based on config
        const behavior = getConfig('issueNotInProject') || 'ask';
        const projects = await api.getProjects(repo);

        if (projects.length === 0) {
            console.error(chalk.red('Error:'), 'No projects found for this repository');
            process.exit(1);
        }

        if (behavior === 'fail') {
            console.error(chalk.red('Error:'), `Issue #${issueNumber} is not in any project`);
            console.log(chalk.dim('Set issueNotInProject to "auto-add" or "ask" in config to handle this'));
            process.exit(1);
        }

        console.log(chalk.yellow(`Issue #${issueNumber} is not in any project.`));

        let selectedProject = projects[0];

        if (behavior === 'ask' && isInteractive()) {
            if (projects.length > 1) {
                const projectNames = projects.map(p => p.title);
                const choiceIdx = await promptSelectWithDefault(
                    'Add to which project?',
                    projectNames,
                    0
                );
                selectedProject = projects[choiceIdx];
            }

            const shouldAdd = await confirmWithDefault(
                `Add issue #${issueNumber} to "${selectedProject.title}"?`,
                true
            );
            if (!shouldAdd) {
                console.log(chalk.dim('Aborted.'));
                process.exit(0);
            }
        } else {
            console.log(chalk.dim(`Auto-adding to "${selectedProject.title}"...`));
        }

        // Add issue to project
        const added = await api.addIssueToProject(repo, issueNumber, selectedProject.id);
        if (!added) {
            console.error(chalk.red('Error:'), 'Failed to add issue to project');
            process.exit(1);
        }
        console.log(chalk.green('✓'), `Added to "${selectedProject.title}"`);

        // Re-fetch the item now that it's in a project
        item = await api.findItemByNumber(repo, issueNumber);
        if (!item) {
            console.error(chalk.red('Error:'), 'Failed to find item after adding to project');
            process.exit(1);
        }
    }

    console.log(chalk.green('Found:'), item.title);
    console.log(chalk.dim(`Project: ${item.projectTitle} | Status: ${item.status || 'None'}`));
    console.log();

    // ═══════════════════════════════════════════════════════════════════════════
    // Check if issue is blocked by other issues
    // ═══════════════════════════════════════════════════════════════════════════
    if (item.blockedBy && item.blockedBy.length > 0) {
        // Filter to only show OPEN blocking issues
        const openBlockers = item.blockedBy.filter(b => b.state === 'OPEN');

        if (openBlockers.length > 0) {
            console.log(chalk.yellow('⚠️  This issue is blocked by:'));
            for (const blocker of openBlockers) {
                const stateColor = blocker.state === 'OPEN' ? chalk.red : chalk.green;
                console.log(`   ${stateColor('#' + blocker.number)} ${blocker.title}`);
            }
            console.log();

            // In non-interactive mode with forceDefaults, proceed anyway
            if (!options.forceDefaults && !options.force) {
                const shouldContinue = await confirmWithDefault(
                    'Continue working on this blocked issue?',
                    false, // default is to abort
                    options.forceDefaults
                );

                if (!shouldContinue) {
                    console.log('Aborted.');
                    process.exit(0);
                }
            } else {
                console.log(chalk.dim('[--force-defaults] Proceeding despite blocking issues'));
            }
            console.log();
        }
    }

    // Check if current user is assigned (skip in review mode)
    const isAssigned = item.assignees.some(
        (a) => a.toLowerCase() === api.username?.toLowerCase()
    );

    if (!isAssigned && !options.review) {
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
    let worktreeBranch: string | undefined; // Branch name for worktree (used in spawn directive)
    let worktreeWasCreated = false; // Track if a NEW worktree was created (for hooks)

    // Remember original branch for --parallel mode (switch back after worktree creation)
    const originalBranch = await getCurrentBranch();

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
                const result = await createParallelWorktree(
                    repo,
                    issueNumber,
                    linkedBranch,
                    item.title,
                    options.worktreePath
                );
                if (!result.success) {
                    console.error(chalk.red('Error:'), result.error);
                    process.exit(1);
                }
                worktreePath = result.path;
                worktreeBranch = linkedBranch;
                worktreeWasCreated = !result.alreadyExisted;
            } else {
                // ─────────────────────────────────────────────────────────────────
                // Switch mode: checkout the branch
                // ─────────────────────────────────────────────────────────────────

                // Check if branch is already in a worktree
                const existingWorktree = await getBranchWorktree(linkedBranch);
                if (existingWorktree) {
                    console.log(chalk.yellow('Branch is in a worktree:'), existingWorktree.path);
                    console.log(chalk.dim('Run:'), `cd ${existingWorktree.path}`);
                    console.log();
                    // Still apply label and show ready message
                    worktreePath = existingWorktree.path;
                    isParallelMode = true; // Treat as parallel for label handling
                } else {
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

        // ═══════════════════════════════════════════════════════════════════════════
        // Handle --parallel flag after new branch creation
        // ═══════════════════════════════════════════════════════════════════════════
        if (options.parallel) {
            // We just created a new branch and are now on it
            // For parallel mode, create a worktree and switch back to original branch
            const newBranchName = await getCurrentBranch();
            if (newBranchName) {
                const result = await createParallelWorktree(
                    repo,
                    issueNumber,
                    newBranchName,
                    item.title,
                    options.worktreePath
                );
                if (!result.success) {
                    console.error(chalk.red('Error:'), result.error);
                    process.exit(1);
                }
                worktreePath = result.path;
                worktreeBranch = newBranchName;
                isParallelMode = true;
                worktreeWasCreated = !result.alreadyExisted;

                // Switch back to original branch so user stays in their previous context
                if (originalBranch && originalBranch !== newBranchName) {
                    await checkoutBranch(originalBranch);
                    console.log(chalk.green('✓'), `Switched back to ${originalBranch} (worktree created)`);
                } else if (!originalBranch) {
                    console.log(chalk.yellow('⚠'), 'Was in detached HEAD state, staying on new branch');
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Update status (unless --no-status or --review)
    // ═══════════════════════════════════════════════════════════════════════════
    if (options.status !== false && !options.review) {
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
    // Apply active label (skip in review mode)
    // ═══════════════════════════════════════════════════════════════════════════
    if (!options.review) {
        // In parallel mode, don't remove label from other issues (non-exclusive)
        await applyActiveLabel(repo, issueNumber, !isParallelMode);
    }

    console.log();
    if (options.review) {
        console.log(chalk.cyan.bold('Review mode:'), item.title);
        console.log(chalk.dim('(skipped status, label, and assignment changes)'));
    } else {
        console.log(chalk.green.bold('Ready to work on:'), item.title);
    }

    // Fire issue-started event hooks (skip in review mode)
    const finalBranch = worktreeBranch || linkedBranch || await getCurrentBranch() || '';
    if (!options.review && hasHooksForEvent('issue-started')) {
        console.log();
        console.log(chalk.dim('Running issue-started hooks...'));

        // Note: ProjectItem doesn't include body, but hooks can fetch it if needed
        const payload: IssueStartedPayload = {
            repo: `${repo.owner}/${repo.name}`,
            issue: {
                number: issueNumber,
                title: item.title,
                body: '', // Body not available from ProjectItem, hooks can fetch via API
                url: `https://github.com/${repo.owner}/${repo.name}/issues/${issueNumber}`,
            },
            branch: finalBranch,
        };

        const results = await executeHooksForEvent('issue-started', payload);

        for (const result of results) {
            if (result.success) {
                console.log(chalk.green('✓'), `Hook "${result.hookName}" completed`);
                if (result.output) {
                    // Show first few lines of output
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

    // Fire worktree-created hooks if a NEW worktree was created (not for existing worktrees)
    if (worktreeWasCreated && worktreePath && hasHooksForEvent('worktree-created')) {
        console.log();
        console.log(chalk.dim('Running worktree-created hooks...'));

        const worktreeName = worktreePath.split('/').pop() || '';
        const worktreePayload: WorktreeCreatedPayload = {
            repo: `${repo.owner}/${repo.name}`,
            issue: {
                number: issueNumber,
                title: item.title,
                url: `https://github.com/${repo.owner}/${repo.name}/issues/${issueNumber}`,
            },
            branch: finalBranch,
            worktree: {
                path: worktreePath,
                name: worktreeName,
            },
        };

        const worktreeResults = await executeHooksForEvent('worktree-created', worktreePayload);

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

    // Show path info for parallel worktree
    if (isParallelMode && worktreePath) {
        console.log();
        console.log(chalk.cyan('Worktree created at:'), worktreePath);

        const mainBranchConfig = getConfig('mainBranch') || 'main';
        // TODO: Use getConfig('memory.namespacePrefix') once memory config is fully integrated
        const namespacePrefix = 'ghp';
        const branchForDirective = worktreeBranch || linkedBranch || 'unknown';

        const directive: SubagentSpawnDirective = {
            action: 'spawn_subagent',
            workingDirectory: worktreePath,
            issue: {
                number: issueNumber,
                title: item.title,
                status: item.status ?? null,
                url: `https://github.com/${repo.owner}/${repo.name}/issues/${issueNumber}`,
            },
            branch: branchForDirective,
            repository: {
                owner: repo.owner,
                name: repo.name,
                mainBranch: mainBranchConfig,
            },
            memory: {
                namespace: `${namespacePrefix}-issue-${issueNumber}`,
            },
            handoffPrompt: `You are now working in a dedicated worktree for issue #${issueNumber}: "${item.title}"

Worktree Location: ${worktreePath}
Branch: ${branchForDirective}
Status: ${item.status || 'None'}
Repository: ${repo.owner}/${repo.name}

Your task is to implement this issue. The worktree has:
- Dependencies installed (if worktreeAutoSetup is enabled)
- Environment files copied from the main repository
- Isolated git state with the issue branch checked out

Use the GHP tools available via MCP to:
- Save your progress with save_session
- Search for relevant context with memory_search
- Mark the issue done when complete`,
        };

        // Determine if we should open a terminal
        const parallelWorkConfig = getParallelWorkConfig();
        const shouldOpenTerminal = options.open !== false && parallelWorkConfig.openTerminal;

        if (shouldOpenTerminal) {
            // Register parent agent (this session) if inside tmux and not already registered
            if (isInsideTmux()) {
                const parentBranch = await getCurrentBranch();
                if (parentBranch) {
                    const parentIssueNumber = extractIssueNumberFromBranch(parentBranch);
                    if (parentIssueNumber && !getAgentByIssue(parentIssueNumber)) {
                        // Get issue title for the parent (we can fetch it or use a placeholder)
                        const parentAgent = registerAgent({
                            issueNumber: parentIssueNumber,
                            issueTitle: `Issue #${parentIssueNumber}`, // Placeholder - could fetch from API
                            pid: process.pid,
                            worktreePath: process.cwd(),
                            branch: parentBranch,
                        });
                        updateAgent(parentAgent.id, { status: 'running' });
                        console.log(chalk.dim(`Parent agent registered: #${parentIssueNumber}`));
                    }
                }
            }

            console.log(chalk.dim('Opening terminal...'));
            const modeOverride = getTerminalModeOverride(options);
            const result = await openParallelWorkTerminal(
                worktreePath,
                issueNumber,
                item.title,
                directive,
                modeOverride
            );

            if (result.success) {
                console.log(chalk.green('✓'), 'Opened new terminal with Claude');

                // Register agent in the registry
                // Note: PID is 0 for now as tmux doesn't return the Claude process PID
                // Cleanup can identify agents by worktree path instead (#108)
                const agent = registerAgent({
                    issueNumber,
                    issueTitle: item.title,
                    pid: 0, // placeholder - tmux manages the process
                    worktreePath: worktreePath!,
                    branch: branchForDirective,
                });
                updateAgent(agent.id, { status: 'running' });
                console.log(chalk.dim(`Agent registered: ${agent.id.substring(0, 8)}...`));

                // Open admin pane (ghp agents watch) if --admin flag is set
                if (options.admin) {
                    const adminResult = await openAdminPane();
                    if (adminResult.success && !adminResult.alreadyOpen) {
                        console.log(chalk.dim('Opened admin pane (ghp-admin window)'));
                    }
                }
            } else {
                console.log(chalk.yellow('⚠'), 'Could not open terminal:', result.error);
                console.log(chalk.dim('Run manually:'), `cd ${worktreePath} && claude`);
                // Output spawn directive as fallback
                console.log();
                console.log('[GHP_SPAWN_DIRECTIVE]');
                console.log(JSON.stringify(directive, null, 2));
                console.log('[/GHP_SPAWN_DIRECTIVE]');
            }
        } else {
            // --no-open flag: output spawn directive for scripting/automation
            console.log(chalk.dim('Run:'), `cd ${worktreePath}`);
            console.log();
            console.log('[GHP_SPAWN_DIRECTIVE]');
            console.log(JSON.stringify(directive, null, 2));
            console.log('[/GHP_SPAWN_DIRECTIVE]');
        }
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

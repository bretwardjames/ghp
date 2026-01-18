import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { api } from '../github-api.js';
import { detectRepository, getCurrentBranch, hasUncommittedChanges, branchExists, createBranch, checkoutBranch, getCommitsBehind, pullLatest, generateBranchName, getAllBranches, type RepoInfo } from '../git-utils.js';
import { getConfig } from '../config.js';
import { linkBranch, getBranchForIssue } from '../branch-linker.js';
import * as readline from 'readline';

const execAsync = promisify(exec);

interface StartOptions {
    branch?: boolean;
    status?: boolean;
}

function prompt(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer.trim().toLowerCase());
        });
    });
}

/**
 * Prompt user to select from a numbered list of options.
 * Returns the index of the selected option.
 */
async function promptSelect(question: string, options: string[]): Promise<number> {
    console.log(question);
    options.forEach((opt, i) => {
        console.log(chalk.cyan(`  [${i + 1}]`), opt);
    });

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => {
        const askQuestion = () => {
            rl.question(chalk.dim(`Enter choice (1-${options.length}): `), answer => {
                const num = parseInt(answer.trim(), 10);
                if (num >= 1 && num <= options.length) {
                    rl.close();
                    resolve(num - 1);
                } else {
                    console.log(chalk.yellow('Invalid choice. Please try again.'));
                    askQuestion();
                }
            });
        };
        askQuestion();
    });
}

/**
 * Handle uncommitted changes - prompt user to continue or abort.
 * Returns true if we should proceed.
 */
async function handleUncommittedChanges(): Promise<boolean> {
    if (await hasUncommittedChanges()) {
        console.log(chalk.yellow('Warning:'), 'You have uncommitted changes.');
        const answer = await prompt('Continue anyway? (y/N) ');
        if (answer !== 'y' && answer !== 'yes') {
            console.log('Aborted.');
            return false;
        }
    }
    return true;
}

/**
 * Apply the "actively working" label to an issue and remove from others.
 */
async function applyActiveLabel(repo: RepoInfo, issueNumber: number): Promise<void> {
    const activeLabel = api.getActiveLabelName();

    // Ensure the label exists
    await api.ensureLabel(repo, activeLabel);

    // Remove label from any other issues that have it
    const issuesWithLabel = await api.findIssuesWithLabel(repo, activeLabel);
    for (const otherIssue of issuesWithLabel) {
        if (otherIssue !== issueNumber) {
            await api.removeLabelFromIssue(repo, otherIssue, activeLabel);
            console.log(chalk.dim(`Removed ${activeLabel} from #${otherIssue}`));
        }
    }

    // Add label to current issue
    const labelAdded = await api.addLabelToIssue(repo, issueNumber, activeLabel);
    if (labelAdded) {
        console.log(chalk.green('✓'), `Applied "${activeLabel}" label`);
    }
}

/**
 * Create a new branch, push it, and link it to the issue.
 */
async function createAndLinkBranch(
    repo: RepoInfo,
    item: { number?: number | null; title: string },
    branchPattern: string
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
        const answer = await prompt('Checkout existing branch? (Y/n) ');
        if (answer !== 'n' && answer !== 'no') {
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
        const choices = ['Reassign to me', 'Add me', 'Leave as is'];
        const choiceIdx = await promptSelect('What would you like to do?', choices);

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

    if (linkedBranch) {
        // ═══════════════════════════════════════════════════════════════════════
        // Issue already has a linked branch - switch to it
        // ═══════════════════════════════════════════════════════════════════════
        const currentBranch = await getCurrentBranch();

        if (currentBranch === linkedBranch) {
            console.log(chalk.dim(`Already on branch: ${linkedBranch}`));
        } else {
            // Check for uncommitted changes before switching
            if (!(await handleUncommittedChanges())) {
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
        if (!(await handleUncommittedChanges())) {
            process.exit(0);
        }

        if (isOnMain) {
            // On main - offer: create new or link existing
            const choices = ['Create new branch (default)', 'Link existing branch'];
            const choice = await promptSelect('What would you like to do?', choices);

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
                const branchIdx = await promptSelect('Select branch to link (sorted by relevance):', sortedBranches);
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
                await handlePullIfBehind(mainBranch);
                await createAndLinkBranch(repo, item, branchPattern);
            }
        } else {
            // Not on main - offer: switch to main & create, create from current, or link existing
            const choices = [
                `Switch to ${mainBranch} & create branch (default)`,
                `Create branch from current (${currentBranch})`,
                'Link existing branch',
            ];
            const choice = await promptSelect('What would you like to do?', choices);

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
                const branchIdx = await promptSelect('Select branch to link (sorted by relevance):', sortedBranches);
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
                await createAndLinkBranch(repo, item, branchPattern);
            } else {
                // Switch to main & create
                await checkoutBranch(mainBranch);
                console.log(chalk.green('✓'), `Switched to ${mainBranch}`);
                await handlePullIfBehind(mainBranch);
                await createAndLinkBranch(repo, item, branchPattern);
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
    await applyActiveLabel(repo, issueNumber);

    console.log();
    console.log(chalk.green.bold('Ready to work on:'), item.title);
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
 */
async function handlePullIfBehind(branch: string): Promise<void> {
    const behind = await getCommitsBehind(branch);
    if (behind > 0) {
        console.log(chalk.yellow('Warning:'), `${branch} is ${behind} commit(s) behind origin.`);
        const answer = await prompt('Pull latest? (Y/n) ');
        if (answer !== 'n' && answer !== 'no') {
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

import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { api } from '../github-api.js';
import { detectRepository, getCurrentBranch, hasUncommittedChanges, branchExists, createBranch, checkoutBranch, getCommitsBehind, pullLatest, generateBranchName } from '../git-utils.js';
import { getConfig } from '../config.js';
import { linkBranch } from '../branch-linker.js';
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

    // Branch creation (unless --no-branch)
    if (options.branch !== false) {
        const mainBranch = getConfig('mainBranch') || 'main';
        const branchPattern = getConfig('branchPattern') || '{user}/{number}-{title}';
        
        // Check for uncommitted changes
        if (await hasUncommittedChanges()) {
            console.log(chalk.yellow('Warning:'), 'You have uncommitted changes.');
            const answer = await prompt('Continue anyway? (y/N) ');
            if (answer !== 'y' && answer !== 'yes') {
                console.log('Aborted.');
                process.exit(0);
            }
        }

        // Check current branch
        const currentBranch = await getCurrentBranch();
        if (currentBranch !== mainBranch) {
            console.log(chalk.yellow('Warning:'), `You're on '${currentBranch}' instead of '${mainBranch}'.`);
            const answer = await prompt(`Switch to ${mainBranch}? (Y/n) `);
            if (answer !== 'n' && answer !== 'no') {
                try {
                    await checkoutBranch(mainBranch);
                    console.log(chalk.green('✓'), `Switched to ${mainBranch}`);
                } catch (error) {
                    console.error(chalk.red('Error:'), `Failed to switch to ${mainBranch}:`, error);
                    process.exit(1);
                }
            }
        }

        // Check if behind origin
        const behind = await getCommitsBehind(mainBranch);
        if (behind > 0) {
            console.log(chalk.yellow('Warning:'), `${mainBranch} is ${behind} commit(s) behind origin.`);
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

        // Generate branch name
        const branchName = generateBranchName(branchPattern, {
            user: api.username || 'user',
            number: item.number,
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

        // Link branch to issue (stores in issue body)
        const linkSuccess = await linkBranch(repo, item.number!, branchName);
        if (linkSuccess) {
            console.log(chalk.green('✓'), `Linked branch to #${item.number}`);
        } else {
            console.log(chalk.yellow('⚠'), `Could not link branch to issue`);
        }
    }

    // Status update (unless --no-status)
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

    // Apply active label
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

    console.log();
    console.log(chalk.green.bold('Ready to work on:'), item.title);
}

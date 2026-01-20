import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository, checkoutBranch, branchExists, getCurrentBranch } from '../git-utils.js';
import { getBranchForIssue } from '../branch-linker.js';

export async function switchCommand(issue: string): Promise<void> {
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

    // Check if already on that branch
    const currentBranch = await getCurrentBranch();
    if (currentBranch === branchName) {
        console.log(chalk.yellow('Already on branch:'), branchName);
        return;
    }

    // Switch to branch
    try {
        await checkoutBranch(branchName);
        console.log(chalk.green('✓'), `Switched to branch: ${branchName}`);
    } catch (error) {
        console.error(chalk.red('Error:'), 'Failed to switch branch:', error);
        process.exit(1);
    }

    // Update active label
    const activeLabel = api.getActiveLabelName();

    // Remove label from any other issues that have it
    const issuesWithLabel = await api.findIssuesWithLabel(repo, activeLabel);
    for (const otherIssue of issuesWithLabel) {
        if (otherIssue !== issueNumber) {
            await api.removeLabelFromIssue(repo, otherIssue, activeLabel);
            console.log(chalk.dim(`Removed ${activeLabel} from #${otherIssue}`));
        }
    }

    // Add label to current issue (ensure it exists first)
    await api.ensureLabel(repo, activeLabel);
    const labelAdded = await api.addLabelToIssue(repo, issueNumber, activeLabel);
    if (labelAdded) {
        console.log(chalk.green('✓'), `Applied "${activeLabel}" label`);
    }
}

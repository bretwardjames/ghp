import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository, getCurrentBranch } from '../git-utils.js';
import { getIssueForBranch } from '../branch-linker.js';

export async function syncCommand(): Promise<void> {
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

    const activeLabel = api.getActiveLabelName();
    const currentBranch = await getCurrentBranch();

    console.log(chalk.bold('Syncing active label:'), activeLabel);
    console.log(chalk.dim(`Current branch: ${currentBranch}`));
    console.log();

    // Find issue linked to current branch (via branch name pattern + issue body verification)
    const linkedIssue = await getIssueForBranch(repo, currentBranch || '');

    // Find all issues currently with the label
    const issuesWithLabel = await api.findIssuesWithLabel(repo, activeLabel);

    // Determine what needs to change
    const toRemove = linkedIssue
        ? issuesWithLabel.filter(n => n !== linkedIssue.issueNumber)
        : issuesWithLabel;
    const needsAdd = linkedIssue && !issuesWithLabel.includes(linkedIssue.issueNumber);

    // Show what will happen
    if (toRemove.length === 0 && !needsAdd) {
        if (linkedIssue) {
            console.log(chalk.green('✓'), `Active label is correctly on #${linkedIssue.issueNumber}`);
        } else {
            console.log(chalk.yellow('No issue linked to current branch.'));
            if (issuesWithLabel.length === 0) {
                console.log(chalk.dim('No issues have the active label.'));
            }
        }
        return;
    }

    console.log(chalk.bold('Changes needed:'));

    for (const issueNum of toRemove) {
        console.log(chalk.red('  - Remove'), activeLabel, chalk.dim(`from #${issueNum}`));
    }

    if (needsAdd && linkedIssue) {
        console.log(chalk.green('  + Add'), activeLabel, chalk.dim(`to #${linkedIssue.issueNumber} (${linkedIssue.issueTitle})`));
    }

    console.log();

    // Apply changes
    // Ensure label exists first
    await api.ensureLabel(repo, activeLabel);

    for (const issueNum of toRemove) {
        const removed = await api.removeLabelFromIssue(repo, issueNum, activeLabel);
        if (removed) {
            console.log(chalk.green('✓'), `Removed from #${issueNum}`);
        } else {
            console.log(chalk.yellow('⚠'), `Could not remove from #${issueNum}`);
        }
    }

    if (needsAdd && linkedIssue) {
        const added = await api.addLabelToIssue(repo, linkedIssue.issueNumber, activeLabel);
        if (added) {
            console.log(chalk.green('✓'), `Added to #${linkedIssue.issueNumber}`);
        } else {
            console.log(chalk.yellow('⚠'), `Could not add to #${linkedIssue.issueNumber}`);
        }
    }

    console.log();
    console.log(chalk.green('Done!'));
}

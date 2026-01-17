import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository } from '../git-utils.js';
import { unlinkBranch, getBranchForIssue } from '../branch-linker.js';

export async function unlinkBranchCommand(issue: string): Promise<void> {
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

    // Authenticate (needed for API calls)
    const authenticated = await api.authenticate();
    if (!authenticated) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run', chalk.cyan('ghp auth'));
        process.exit(1);
    }

    // Check if linked
    const branchName = await getBranchForIssue(repo, issueNumber);
    if (!branchName) {
        console.log(chalk.yellow('No branch linked to issue'), `#${issueNumber}`);
        return;
    }

    // Unlink (removes from issue body)
    const removed = await unlinkBranch(repo, issueNumber);
    if (removed) {
        console.log(chalk.green('✓'), `Unlinked "${branchName}" from #${issueNumber}`);
    } else {
        console.error(chalk.red('Error:'), 'Failed to unlink branch');
        process.exit(1);
    }
}

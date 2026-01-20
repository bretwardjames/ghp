import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository } from '../git-utils.js';
import { getConfig } from '../config.js';

export async function doneCommand(issue: string): Promise<void> {
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
    const item = await api.findItemByNumber(repo, issueNumber);
    if (!item) {
        console.error(chalk.red('Error:'), `Issue #${issueNumber} not found in any project`);
        process.exit(1);
    }

    const targetStatus = getConfig('doneStatus');
    
    if (item.status === targetStatus) {
        console.log(chalk.yellow('Already done:'), item.title);
        return;
    }

    const statusField = await api.getStatusField(item.projectId);
    if (!statusField) {
        console.error(chalk.red('Error:'), 'Could not find Status field in project');
        process.exit(1);
    }

    const option = statusField.options.find(o => o.name === targetStatus);
    if (!option) {
        console.error(chalk.red('Error:'), `Status "${targetStatus}" not found in project`);
        console.log('Available:', statusField.options.map(o => o.name).join(', '));
        process.exit(1);
    }

    const success = await api.updateItemStatus(
        item.projectId,
        item.id,
        statusField.fieldId,
        option.id
    );

    if (success) {
        console.log(chalk.green('✓'), `Marked as done: ${item.title}`);
    } else {
        console.error(chalk.red('Error:'), 'Failed to update status');
        process.exit(1);
    }
}

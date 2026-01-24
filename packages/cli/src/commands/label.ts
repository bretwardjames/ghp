import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository } from '../git-utils.js';

interface LabelOptions {
    remove?: boolean;
}

export async function labelCommand(
    issue: string, 
    labels: string[], 
    options: LabelOptions
): Promise<void> {
    const issueNumber = parseInt(issue, 10);
    if (isNaN(issueNumber)) {
        console.error(chalk.red('Error:'), 'Issue must be a number');
        process.exit(1);
    }

    if (labels.length === 0) {
        console.error(chalk.red('Error:'), 'At least one label is required');
        console.log(chalk.dim('Usage: ghp label <issue> <labels...>'));
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

    const applied: string[] = [];
    const failed: string[] = [];

    for (const label of labels) {
        let success: boolean;
        if (options.remove) {
            success = await api.removeLabelFromIssue(repo, issueNumber, label);
        } else {
            success = await api.addLabelToIssue(repo, issueNumber, label);
        }

        if (success) {
            applied.push(label);
        } else {
            failed.push(label);
        }
    }

    if (options.remove) {
        if (applied.length > 0) {
            console.log(chalk.green('✓'), `Removed labels from #${issueNumber}:`, applied.join(', '));
        }
        if (failed.length > 0) {
            console.log(chalk.yellow('Warning:'), `Labels not found or couldn't remove:`, failed.join(', '));
        }
    } else {
        if (applied.length > 0) {
            console.log(chalk.green('✓'), `Added labels to #${issueNumber}:`, applied.join(', '));
        }
        if (failed.length > 0) {
            console.log(chalk.yellow('Warning:'), `Labels not found in repo:`, failed.join(', '));
            console.log(chalk.dim('Tip: Labels must exist in the repository before applying'));
        }
    }

    if (applied.length === 0) {
        process.exit(1);
    }
}

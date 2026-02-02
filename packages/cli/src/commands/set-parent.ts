import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository } from '../git-utils.js';
import { exit } from '../exit.js';

interface SetParentOptions {
    parent?: string;
    remove?: boolean;
}

export async function setParentCommand(
    issue: string,
    options: SetParentOptions
): Promise<void> {
    const repo = await detectRepository();
    if (!repo) {
        console.error(chalk.red('Error:'), 'Not in a git repository with a GitHub remote');
        exit(1);
    }

    const authenticated = await api.authenticate();
    if (!authenticated) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run', chalk.cyan('ghp auth'));
        exit(1);
    }

    const issueNumber = parseInt(issue, 10);
    if (isNaN(issueNumber)) {
        console.error(chalk.red('Error:'), `Invalid issue number: ${issue}`);
        exit(1);
    }

    // Handle remove
    if (options.remove) {
        // Get current relationships to find parent
        const relationships = await api.getIssueRelationships(repo, issueNumber);
        if (!relationships) {
            console.error(chalk.red('Error:'), `Issue #${issueNumber} not found`);
            exit(1);
        }

        if (!relationships.parent) {
            console.log(chalk.dim(`Issue #${issueNumber} has no parent issue`));
            return;
        }

        const success = await api.removeSubIssue(repo, relationships.parent.number, issueNumber);
        if (success) {
            console.log(chalk.green('Removed:'), `#${issueNumber} from parent #${relationships.parent.number}`);
        } else {
            console.error(chalk.red('Error:'), 'Failed to remove parent relationship');
            exit(1);
        }
        return;
    }

    // Handle set parent
    if (!options.parent) {
        console.error(chalk.red('Error:'), 'Either --parent <number> or --remove is required');
        exit(1);
    }

    const parentNumber = parseInt(options.parent, 10);
    if (isNaN(parentNumber)) {
        console.error(chalk.red('Error:'), `Invalid parent issue number: ${options.parent}`);
        exit(1);
    }

    if (parentNumber === issueNumber) {
        console.error(chalk.red('Error:'), 'An issue cannot be its own parent');
        exit(1);
    }

    const success = await api.addSubIssue(repo, parentNumber, issueNumber);
    if (success) {
        console.log(chalk.green('Linked:'), `#${issueNumber} as sub-issue of #${parentNumber}`);
    } else {
        console.error(chalk.red('Error:'), 'Failed to set parent issue');
        console.log(chalk.dim('Make sure both issues exist and the sub-issues feature is enabled'));
        exit(1);
    }
}

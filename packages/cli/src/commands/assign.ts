import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { api } from '../github-api.js';
import { detectRepository } from '../git-utils.js';

const execAsync = promisify(exec);

interface AssignOptions {
    remove?: boolean;
}

export async function assignCommand(
    issue: string, 
    users: string[], 
    options: AssignOptions
): Promise<void> {
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

    // Default to self if no users specified
    const assignees = users.length > 0 ? users : [api.username!];
    const assigneeList = assignees.join(',');

    try {
        if (options.remove) {
            await execAsync(`gh issue edit ${issueNumber} --remove-assignee "${assigneeList}"`);
            console.log(chalk.green('✓'), `Removed ${assigneeList} from #${issueNumber}`);
        } else {
            await execAsync(`gh issue edit ${issueNumber} --add-assignee "${assigneeList}"`);
            console.log(chalk.green('✓'), `Assigned ${assigneeList} to #${issueNumber}`);
        }
    } catch (error: unknown) {
        const err = error as { stderr?: string };
        console.error(chalk.red('Error:'), err.stderr || 'Failed to update assignees');
        process.exit(1);
    }
}

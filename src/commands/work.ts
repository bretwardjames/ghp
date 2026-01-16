import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository } from '../git-utils.js';
import type { ProjectItem } from '../types.js';

interface WorkOptions {
    all?: boolean;
    status?: string;
    hideDone?: boolean;
    list?: boolean;
}

export async function workCommand(options: WorkOptions): Promise<void> {
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

    console.log(chalk.bold('My Work'), chalk.dim(`(${repo.fullName})`));
    console.log();

    // Get projects
    const projects = await api.getProjects(repo);
    if (projects.length === 0) {
        console.log(chalk.yellow('No GitHub Projects found for this repository.'));
        return;
    }

    // Collect all items
    let allItems: ProjectItem[] = [];
    for (const project of projects) {
        const items = await api.getProjectItems(project.id, project.title);
        allItems = allItems.concat(items);
    }

    // Filter items
    let filteredItems = allItems;

    // Filter to assigned to me (default unless --all)
    if (!options.all) {
        filteredItems = filteredItems.filter(item => 
            item.assignees.includes(api.username || '')
        );
    }

    // Filter by status
    if (options.status) {
        filteredItems = filteredItems.filter(item =>
            item.status?.toLowerCase() === options.status?.toLowerCase()
        );
    }

    // Hide done items
    if (options.hideDone) {
        filteredItems = filteredItems.filter(item =>
            !['Done', 'Closed', 'Completed'].includes(item.status || '')
        );
    }

    if (filteredItems.length === 0) {
        if (options.all) {
            console.log(chalk.yellow('No items found.'));
        } else {
            console.log(chalk.yellow('No items assigned to you.'));
            console.log(chalk.dim('Use --all to see all items.'));
        }
        return;
    }

    // Group by status with priority ordering
    const statusOrder = ['In Progress', 'Todo', 'Backlog', 'In Review', 'Done', 'Closed'];
    const byStatus = new Map<string, ProjectItem[]>();
    
    for (const item of filteredItems) {
        const status = item.status || 'No Status';
        if (!byStatus.has(status)) {
            byStatus.set(status, []);
        }
        byStatus.get(status)!.push(item);
    }

    // Sort statuses
    const sortedStatuses = [...byStatus.keys()].sort((a, b) => {
        const aIdx = statusOrder.indexOf(a);
        const bIdx = statusOrder.indexOf(b);
        if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
        if (aIdx === -1) return 1;
        if (bIdx === -1) return -1;
        return aIdx - bIdx;
    });

    // Simple list output for pickers
    if (options.list) {
        for (const status of sortedStatuses) {
            const items = byStatus.get(status)!;
            for (const item of items) {
                const num = item.number ? `#${item.number}` : '';
                console.log(`${num} ${item.title} [${status}]`);
            }
        }
        return;
    }

    // Display
    for (const status of sortedStatuses) {
        const items = byStatus.get(status)!;
        const statusColor = getStatusColor(status);
        console.log(statusColor(`■ ${status}`) + chalk.dim(` (${items.length})`));

        for (const item of items) {
            const num = item.number ? chalk.cyan(`#${item.number}`) : chalk.dim('draft');
            const typeIcon = item.type === 'pull_request' ? chalk.magenta('⎇') : ' ';
            console.log(`  ${typeIcon} ${num} ${item.title}`);
        }
        console.log();
    }
}

function getStatusColor(status: string): typeof chalk.white {
    switch (status.toLowerCase()) {
        case 'in progress':
            return chalk.yellow;
        case 'todo':
        case 'backlog':
            return chalk.blue;
        case 'in review':
            return chalk.magenta;
        case 'done':
        case 'closed':
        case 'completed':
            return chalk.green;
        default:
            return chalk.white;
    }
}

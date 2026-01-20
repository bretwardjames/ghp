import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository } from '../git-utils.js';
import type { ProjectItem } from '../types.js';

interface SliceOptions {
    field?: string;
    value?: string;
    listFields?: boolean;
}

export async function sliceCommand(options: SliceOptions): Promise<void> {
    const repo = await detectRepository();
    if (!repo) {
        console.error(chalk.red('Error:'), 'Not in a git repository with a GitHub remote');
        process.exit(1);
    }

    const authenticated = await api.authenticate();
    if (!authenticated) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run', chalk.cyan('ghp auth'));
        process.exit(1);
    }

    const projects = await api.getProjects(repo);
    if (projects.length === 0) {
        console.log(chalk.yellow('No GitHub Projects found for this repository.'));
        return;
    }

    // List available fields
    if (options.listFields) {
        console.log(chalk.bold('Available Fields:'));
        console.log();
        for (const project of projects) {
            console.log(chalk.cyan(project.title));
            const fields = await api.getProjectFields(project.id);
            for (const field of fields) {
                if (field.options) {
                    console.log(`  ${field.name}: ${field.options.map(o => o.name).join(', ')}`);
                } else {
                    console.log(`  ${field.name} (${field.type || 'text'})`);
                }
            }
            console.log();
        }
        return;
    }

    // Need both field and value for filtering
    if (!options.field || !options.value) {
        console.log(chalk.yellow('Usage:'), 'ghp slice -f <field> -v <value>');
        console.log(chalk.dim('Use --list-fields to see available fields'));
        return;
    }

    console.log(chalk.bold('Filtered Items'), chalk.dim(`(${options.field} = ${options.value})`));
    console.log();

    // Collect and filter items
    let allItems: ProjectItem[] = [];
    for (const project of projects) {
        const items = await api.getProjectItems(project.id, project.title);
        allItems = allItems.concat(items);
    }

    // For status field, filter directly
    const fieldLower = options.field.toLowerCase();
    const valueLower = options.value.toLowerCase();

    const filtered = allItems.filter(item => {
        if (fieldLower === 'status') {
            return item.status?.toLowerCase() === valueLower;
        }
        if (fieldLower === 'assignee' || fieldLower === 'assigned') {
            return item.assignees.some(a => a.toLowerCase() === valueLower);
        }
        if (fieldLower === 'type') {
            return item.type === valueLower;
        }
        if (fieldLower === 'project') {
            return item.projectTitle.toLowerCase().includes(valueLower);
        }
        // For other fields, we'd need to fetch field values - not implemented yet
        return true;
    });

    if (filtered.length === 0) {
        console.log(chalk.yellow('No items match the filter.'));
        return;
    }

    // Display results
    for (const item of filtered) {
        const num = item.number ? chalk.cyan(`#${item.number}`) : chalk.dim('draft');
        const status = item.status ? chalk.dim(`[${item.status}]`) : '';
        console.log(`  ${num} ${item.title} ${status}`);
    }

    console.log();
    console.log(chalk.dim(`${filtered.length} item(s) found`));
}

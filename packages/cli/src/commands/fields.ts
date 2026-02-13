import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository } from '../git-utils.js';
import { exit } from '../exit.js';

interface FieldsOptions {
    project?: string;
    json?: boolean;
}

export async function fieldsCommand(options: FieldsOptions): Promise<void> {
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

    const projects = await api.getProjects(repo);
    if (projects.length === 0) {
        console.error(chalk.red('Error:'), 'No projects found for this repository');
        exit(1);
    }

    // Select project by name if --project, otherwise first
    let project = projects[0];
    if (options.project) {
        const match = projects.find(
            p => p.title.toLowerCase() === options.project!.toLowerCase()
        );
        if (!match) {
            console.error(chalk.red('Error:'), `Project "${options.project}" not found`);
            console.log('Available projects:', projects.map(p => p.title).join(', '));
            exit(1);
        }
        project = match;
    }

    const fields = await api.getProjectFields(project.id);

    if (options.json) {
        const output = {
            project: project.title,
            fields: fields.map(f => ({
                name: f.name,
                type: f.type || 'Text',
                options: f.options?.map(o => o.name),
            })),
        };
        console.log(JSON.stringify(output, null, 2));
        return;
    }

    // Text output
    console.log(`\nFields for project ${chalk.bold(`"${project.title}"`)}:\n`);

    // Find the longest field name for alignment
    const maxNameLen = Math.max(...fields.map(f => f.name.length));

    for (const field of fields) {
        const paddedName = field.name.padEnd(maxNameLen);
        const label = chalk.cyan(paddedName);

        if (field.type === 'SingleSelect' && field.options && field.options.length > 0) {
            const optionStr = field.options.map(o => o.name).join(' | ');
            console.log(`  ${label}   ${optionStr}`);
        } else {
            const typeLabel = field.type || 'Text';
            console.log(`  ${label}   ${chalk.dim(`(${typeLabel.toLowerCase()} field)`)}`);
        }
    }

    console.log();
}

import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository } from '../git-utils.js';
import type { ProjectItem } from '../types.js';
import { exit } from '../exit.js';

interface ProgressOptions {
    project?: string;
    type?: string;
    all?: boolean;
}

interface EpicProgress {
    issue: ProjectItem;
    subIssues: Array<{
        number: number;
        title: string;
        state: string;
        inProject: boolean;
        isCompleted: boolean;
    }>;
    completed: number;
    total: number;
}

/**
 * Render a progress bar with chalk colors
 */
function renderProgressBar(completed: number, total: number, width: number = 20): string {
    if (total === 0) return chalk.dim('─'.repeat(width));
    
    const percentage = completed / total;
    const filledWidth = Math.round(percentage * width);
    const emptyWidth = width - filledWidth;
    
    const filled = chalk.green('█'.repeat(filledWidth));
    const empty = chalk.dim('░'.repeat(emptyWidth));
    
    return `${filled}${empty}`;
}

/**
 * Format percentage with color based on completion
 */
function formatPercentage(completed: number, total: number): string {
    if (total === 0) return chalk.dim('0%');
    
    const pct = Math.round((completed / total) * 100);
    
    if (pct >= 100) return chalk.green(`${pct}%`);
    if (pct >= 75) return chalk.greenBright(`${pct}%`);
    if (pct >= 50) return chalk.yellow(`${pct}%`);
    if (pct >= 25) return chalk.yellowBright(`${pct}%`);
    return chalk.dim(`${pct}%`);
}

export async function progressCommand(options: ProgressOptions): Promise<void> {
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

    // Get projects
    const projects = await api.getProjects(repo);
    if (projects.length === 0) {
        console.error(chalk.red('Error:'), 'No GitHub Projects found for this repository');
        exit(1);
    }

    // Select project(s)
    const targetProjects = options.project
        ? projects.filter(p => p.title.toLowerCase().includes(options.project!.toLowerCase()))
        : projects;

    if (targetProjects.length === 0) {
        console.error(chalk.red('Error:'), `Project "${options.project}" not found`);
        console.log('Available projects:', projects.map(p => p.title).join(', '));
        exit(1);
    }

    console.log(chalk.dim(`Loading ${targetProjects.map(p => p.title).join(', ')}...\n`));

    // Get project items from all target projects (now includes relationships!)
    let allItems: ProjectItem[] = [];
    for (const project of targetProjects) {
        const items = await api.getProjectItems(project.id, project.title);
        allItems = allItems.concat(items);
    }

    if (allItems.length === 0) {
        console.log(chalk.dim('No items in project'));
        return;
    }

    // Filter to issues with sub-issues (epics)
    let epicItems = allItems.filter(item => 
        item.type === 'issue' && 
        item.number !== null &&
        item.subIssues.length > 0
    );

    // Optionally filter by issue type (e.g., "Epic")
    if (options.type) {
        epicItems = epicItems.filter(item =>
            item.issueType?.toLowerCase() === options.type!.toLowerCase()
        );
    }

    if (epicItems.length === 0) {
        console.log(chalk.dim('No epics (issues with sub-issues) found.'));
        if (!options.type) {
            console.log(chalk.dim('\nTip: Create parent/child relationships with:'));
            console.log(chalk.cyan('  ghp set-parent <child> --parent <parent>'));
        }
        return;
    }

    // Build set of issue numbers in project for "in project" tagging
    const itemNumbers = new Set(allItems.filter(i => i.number).map(i => i.number!));

    // Build map of issue numbers to their project status for completion detection
    const itemStatusMap = new Map(
        allItems.filter(i => i.number).map(i => [i.number!, i.status])
    );

    // Statuses that indicate completion (issue shipped or closed)
    const completedStatuses = new Set(['done', 'in beta', 'ready for beta']);

    // Build epics list
    const epics: EpicProgress[] = epicItems.map(item => {
        const subIssues = item.subIssues.map(sub => {
            const inProject = itemNumbers.has(sub.number);
            // Completed if GitHub state is CLOSED OR project status indicates completion
            const status = itemStatusMap.get(sub.number);
            const isCompleted = sub.state === 'CLOSED' ||
                (status != null && completedStatuses.has(status.toLowerCase()));

            return {
                number: sub.number,
                title: sub.title,
                state: sub.state,
                inProject,
                isCompleted,
            };
        });

        const completed = subIssues.filter(s => s.isCompleted).length;

        return {
            issue: item,
            subIssues,
            completed,
            total: subIssues.length,
        };
    });

    // Sort epics: incomplete first, then by completion percentage
    epics.sort((a, b) => {
        const pctA = a.total > 0 ? a.completed / a.total : 0;
        const pctB = b.total > 0 ? b.completed / b.total : 0;
        
        // Incomplete before complete
        if (pctA >= 1 && pctB < 1) return 1;
        if (pctB >= 1 && pctA < 1) return -1;
        
        // Then by percentage descending
        return pctB - pctA;
    });

    // Render epics
    console.log(chalk.bold('Feature Progress\n'));

    for (const epic of epics) {
        const { issue, subIssues, completed, total } = epic;
        
        // Epic header with progress bar
        const bar = renderProgressBar(completed, total);
        const pct = formatPercentage(completed, total);
        const count = chalk.dim(`(${completed}/${total})`);
        
        const statusBadge = issue.status 
            ? chalk.dim(`[${issue.status}]`) 
            : '';
        
        console.log(
            `${chalk.cyan(`#${issue.number}`)} ${issue.title} ${statusBadge}`
        );
        console.log(`    ${bar} ${pct} ${count}`);

        // Sub-issues (only show if --all or few items)
        const showDetails = options.all || subIssues.length <= 10;
        
        if (showDetails) {
            for (const sub of subIssues) {
                const icon = sub.isCompleted
                    ? chalk.green('✓')
                    : chalk.dim('○');
                const title = sub.isCompleted
                    ? chalk.dim(sub.title)
                    : sub.title;
                const inProjectTag = sub.inProject ? '' : chalk.dim(' (not in project)');

                console.log(`    ${icon} #${sub.number} ${title}${inProjectTag}`);
            }
        } else {
            console.log(chalk.dim(`    ... ${total} sub-issues (use --all to show)`));
        }
        
        console.log();
    }

    // Summary
    const totalCompleted = epics.reduce((sum, e) => sum + e.completed, 0);
    const totalItems = epics.reduce((sum, e) => sum + e.total, 0);
    
    console.log(chalk.dim('─'.repeat(50)));
    console.log(
        `${chalk.bold('Overall:')} ` +
        `${renderProgressBar(totalCompleted, totalItems, 30)} ` +
        `${formatPercentage(totalCompleted, totalItems)} ` +
        chalk.dim(`(${totalCompleted}/${totalItems} across ${epics.length} epics)`)
    );
}

import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository } from '../git-utils.js';
import { getShortcut, getPlanDefaults, listShortcuts } from '../config.js';
import type { ProjectItem } from '../types.js';

interface PlanOptions {
    project?: string;
    status?: string;
    mine?: boolean;
    unassigned?: boolean;
    list?: boolean;
    sort?: string;
    slice?: string[];
}

export async function planCommand(shortcut?: string, command?: any): Promise<void> {
    // Commander passes (shortcut, options) for optional positional args
    // The options object is passed directly, not as command.opts()
    const cliOpts: PlanOptions = command?.opts?.() || command || {};

    let options: PlanOptions;
    let shortcutName: string | undefined = shortcut;

    // Load defaults first
    const defaults = getPlanDefaults();

    // If shortcut specified, load and merge it
    if (shortcutName) {
        const shortcut = getShortcut(shortcutName);
        if (!shortcut) {
            console.error(chalk.red('Unknown shortcut:'), shortcutName);
            console.log();
            const shortcuts = listShortcuts();
            if (Object.keys(shortcuts).length > 0) {
                console.log(chalk.dim('Available shortcuts:'));
                for (const [name, sc] of Object.entries(shortcuts)) {
                    const parts: string[] = [];
                    if (sc.project) parts.push(`--project ${sc.project}`);
                    if (sc.status) parts.push(`--status ${sc.status}`);
                    if (sc.mine) parts.push('--mine');
                    if (sc.unassigned) parts.push('--unassigned');
                    if (sc.slice) parts.push(...sc.slice.map(s => `--slice ${s}`));
                    console.log(`  ${chalk.cyan(name)}: ${parts.join(' ')}`);
                }
            } else {
                console.log(chalk.dim('No shortcuts configured. Add them to ~/.config/ghp-cli/config.json'));
            }
            process.exit(1);
        }
        // Merge: defaults < shortcut < CLI options
        options = {
            ...defaults,
            ...shortcut,
            ...cliOpts,
            // Merge slice arrays
            slice: [...(defaults.slice || []), ...(shortcut.slice || []), ...(cliOpts.slice || [])],
        };
    } else {
        // Merge: defaults < CLI options
        options = {
            ...defaults,
            ...cliOpts,
            slice: [...(defaults.slice || []), ...(cliOpts.slice || [])],
        };
    }

    // Remove duplicate slices
    if (options.slice) {
        options.slice = [...new Set(options.slice)];
    }
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

    // Filter by project if specified
    const targetProjects = options.project
        ? projects.filter(p => p.title.toLowerCase().includes(options.project!.toLowerCase()))
        : projects;

    if (targetProjects.length === 0) {
        console.log(chalk.yellow(`No project matching "${options.project}" found.`));
        return;
    }

    // Collect all items from target projects
    let allItems: ProjectItem[] = [];
    for (const project of targetProjects) {
        const items = await api.getProjectItems(project.id, project.title);
        allItems = allItems.concat(items);
    }

    // Apply filters
    let filteredItems = allItems;

    // --mine: filter to current user
    if (options.mine) {
        filteredItems = filteredItems.filter(item =>
            item.assignees.includes(api.username || '')
        );
    }

    // --unassigned: filter to items with no assignees
    if (options.unassigned) {
        filteredItems = filteredItems.filter(item =>
            item.assignees.length === 0
        );
    }

    // --status: filter by status
    if (options.status) {
        filteredItems = filteredItems.filter(item =>
            item.status?.toLowerCase() === options.status!.toLowerCase()
        );
    }

    // --slice: filter by field=value pairs
    if (options.slice && options.slice.length > 0) {
        for (const slice of options.slice) {
            const [field, value] = slice.split('=');
            if (!field || !value) {
                console.error(chalk.red('Invalid slice format:'), slice);
                console.log(chalk.dim('Use: --slice field=value'));
                continue;
            }

            const fieldLower = field.toLowerCase();
            const valueLower = value.toLowerCase();

            filteredItems = filteredItems.filter(item => {
                // Check built-in fields
                if (fieldLower === 'assignee' || fieldLower === 'user') {
                    return item.assignees.some(a => a.toLowerCase().includes(valueLower));
                }
                if (fieldLower === 'label') {
                    return item.labels.some(l => l.name.toLowerCase().includes(valueLower));
                }
                if (fieldLower === 'type' || fieldLower === 'issuetype' || fieldLower === 'issue-type') {
                    return item.issueType?.toLowerCase().includes(valueLower) || false;
                }
                if (fieldLower === 'repo' || fieldLower === 'repository') {
                    return item.repository?.toLowerCase().includes(valueLower);
                }
                if (fieldLower === 'project') {
                    return item.projectTitle.toLowerCase().includes(valueLower);
                }

                // Check custom project fields
                const fieldValue = item.fields[field] || item.fields[fieldLower];
                if (fieldValue) {
                    return fieldValue.toLowerCase().includes(valueLower);
                }

                // Check with case-insensitive field name match
                const matchingField = Object.entries(item.fields).find(
                    ([k]) => k.toLowerCase() === fieldLower
                );
                if (matchingField) {
                    return matchingField[1].toLowerCase().includes(valueLower);
                }

                return false;
            });
        }
    }

    // Sort items if requested
    if (options.sort) {
        const sortFields = options.sort.split(',').map(f => f.trim());
        filteredItems.sort((a, b) => {
            for (const field of sortFields) {
                const ascending = field.startsWith('-');
                const fieldName = ascending ? field.slice(1) : field;

                // Get field values (handle special fields and custom fields)
                let aVal: any = getFieldValue(a, fieldName);
                let bVal: any = getFieldValue(b, fieldName);

                // Compare
                if (aVal === bVal) continue;
                if (aVal === null || aVal === undefined) return ascending ? -1 : 1;
                if (bVal === null || bVal === undefined) return ascending ? 1 : -1;

                // String comparison
                if (typeof aVal === 'string' && typeof bVal === 'string') {
                    const cmp = aVal.localeCompare(bVal);
                    return ascending ? cmp : -cmp;
                }

                // Number comparison
                if (aVal < bVal) return ascending ? -1 : 1;
                if (aVal > bVal) return ascending ? 1 : -1;
            }
            return 0;
        });
    }

    // Display based on mode
    if (options.list) {
        // Simple list view (one item per line, for pickers)
        displaySimpleList(filteredItems);
    } else if (options.status) {
        // List view for single status
        displayListView(filteredItems, options.status, options);
    } else {
        // Board view
        displayBoardView(filteredItems, targetProjects, options);
    }
}

function getFieldValue(item: ProjectItem, fieldName: string): any {
    const lower = fieldName.toLowerCase();

    // Built-in fields
    switch (lower) {
        case 'number': return item.number;
        case 'title': return item.title;
        case 'status': return item.status;
        case 'type': return item.type;
        default:
            // Check custom fields
            const customField = Object.entries(item.fields || {}).find(
                ([k]) => k.toLowerCase() === lower
            );
            return customField ? customField[1] : null;
    }
}

function displaySimpleList(items: ProjectItem[]): void {
    for (const item of items) {
        const num = item.number ? `#${item.number}` : '';
        const status = item.status ? `[${item.status}]` : '';
        console.log(`${num} ${item.title} ${status}`);
    }
}

function displayListView(items: ProjectItem[], status: string, opts: PlanOptions): void {
    const label = opts.mine ? `My ${status}` : opts.unassigned ? `Unassigned ${status}` : status;
    console.log(chalk.bold(label), chalk.dim(`(${items.length} items)`));
    console.log();

    if (items.length === 0) {
        console.log(chalk.dim('No items found.'));
        return;
    }

    for (const item of items) {
        const parts: string[] = [];

        // #123
        parts.push(item.number ? chalk.cyan(`#${item.number}`) : chalk.dim('draft'));

        // Issue Type (org-level)
        if (item.issueType) {
            parts.push(chalk.yellow(item.issueType));
        }

        // Title
        parts.push(item.title);

        // @assignees
        if (item.assignees.length > 0) {
            parts.push(item.assignees.map(a => chalk.cyan('@' + a)).join(' '));
        }

        // Priority (if exists)
        const priority = item.fields['Priority'] || item.fields['priority'];
        if (priority) {
            parts.push(chalk.magenta(priority));
        }

        // Size (if exists)
        const size = item.fields['Size'] || item.fields['size'] || item.fields['Estimate'] || item.fields['estimate'];
        if (size) {
            parts.push(chalk.blue(size));
        }

        // Labels
        if (item.labels.length > 0) {
            const labelStr = item.labels.map(l => {
                const bg = hexToChalk(l.color);
                return bg(` ${l.name} `);
            }).join(' ');
            parts.push(labelStr);
        }

        console.log(`  ${parts.join(' ')}`);
    }
    console.log();
}

function hexToChalk(hex: string): (text: string) => string {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const textColor = luminance > 0.5 ? chalk.black : chalk.white;
    return (text: string) => textColor.bgRgb(r, g, b)(text);
}

async function displayBoardView(
    items: ProjectItem[],
    projects: Array<{ id: string; title: string; url: string }>,
    opts: PlanOptions
): Promise<void> {
    for (const project of projects) {
        const projectItems = items.filter(i => i.projectId === project.id);

        console.log(chalk.bold.underline(project.title));
        if (opts.mine) {
            console.log(chalk.dim('Filtered to: my items'));
        }
        console.log();

        const statusField = await api.getStatusField(project.id);
        if (!statusField) {
            console.log(chalk.yellow('No Status field found in this project.'));
            continue;
        }

        // Group items by status
        const byStatus = new Map<string, ProjectItem[]>();
        for (const status of statusField.options) {
            byStatus.set(status.name, []);
        }
        byStatus.set('No Status', []);

        for (const item of projectItems) {
            const status = item.status || 'No Status';
            if (!byStatus.has(status)) {
                byStatus.set(status, []);
            }
            byStatus.get(status)!.push(item);
        }

        // Calculate column widths
        const termWidth = process.stdout.columns || 120;
        const numColumns = statusField.options.length;
        const colWidth = Math.floor((termWidth - 4) / Math.min(numColumns, 4)) - 2;

        const statuses = statusField.options.map((o: { id: string; name: string }) => o.name);

        // Print headers with counts
        const headers = statuses.map(s => {
            const statusItems = byStatus.get(s) || [];
            const header = `${s} (${statusItems.length})`;
            return chalk.bold(header.padEnd(colWidth).substring(0, colWidth));
        });
        console.log(headers.join('  '));
        console.log(chalk.dim('─'.repeat(termWidth - 4)));

        // Find max items in any column
        const maxItems = Math.max(...statuses.map(s => (byStatus.get(s) || []).length), 1);

        // Print rows
        for (let i = 0; i < Math.min(maxItems, 15); i++) {
            const row = statuses.map(s => {
                const statusItems = byStatus.get(s) || [];
                if (i < statusItems.length) {
                    const item = statusItems[i];
                    const num = item.number ? `#${item.number}` : '';
                    const text = `${num} ${item.title}`.substring(0, colWidth - 1);
                    const color = item.assignees.includes(api.username || '')
                        ? chalk.cyan
                        : chalk.white;
                    return color(text.padEnd(colWidth));
                }
                return ' '.repeat(colWidth);
            });
            console.log(row.join('  '));
        }

        if (maxItems > 15) {
            console.log(chalk.dim(`... and ${maxItems - 15} more items`));
        }

        console.log();
    }
}

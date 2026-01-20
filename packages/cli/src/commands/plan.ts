import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository } from '../git-utils.js';
import { getShortcut, getPlanDefaults, listShortcuts, getConfig } from '../config.js';
import { displayTable, parseColumns, DEFAULT_COLUMNS, calculateColumnWidths, displayTableWithWidths, type ColumnName } from '../table.js';
import type { ProjectItem } from '../types.js';

interface PlanOptions {
    project?: string;
    status?: string | string[];
    mine?: boolean;
    unassigned?: boolean;
    list?: boolean;
    sort?: string;
    slice?: string[];
    all?: boolean;
    view?: string;
    group?: string;
}

/**
 * Parse and apply a GitHub Project view filter expression
 * Format: field:value1,value2 field2:value3 -field3:excluded
 * Special: @me expands to current username
 */
function applyViewFilter(items: ProjectItem[], filterExpr: string, username: string): ProjectItem[] {
    if (!filterExpr.trim()) return items;

    // Parse filter tokens: field:values or -field:values (negation)
    const tokens = filterExpr.match(/(-?\w+):"([^"]+)"|(-?\w+):(\S+)/g) || [];

    let result = items;

    for (const token of tokens) {
        const negated = token.startsWith('-');
        const cleanToken = negated ? token.slice(1) : token;

        // Parse field:values
        const colonIdx = cleanToken.indexOf(':');
        if (colonIdx === -1) continue;

        const field = cleanToken.slice(0, colonIdx).toLowerCase();
        let valuesStr = cleanToken.slice(colonIdx + 1);

        // Remove quotes if present
        if (valuesStr.startsWith('"') && valuesStr.endsWith('"')) {
            valuesStr = valuesStr.slice(1, -1);
        }

        // Split values by comma and expand @me
        const values = valuesStr.split(',').map(v => {
            const trimmed = v.trim();
            return trimmed === '@me' ? username : trimmed;
        });

        result = result.filter(item => {
            let matches = false;

            switch (field) {
                case 'status':
                    matches = values.some(v =>
                        item.status?.toLowerCase() === v.toLowerCase()
                    );
                    break;
                case 'assignee':
                case 'assignees':
                    matches = values.some(v =>
                        item.assignees.some(a => a.toLowerCase() === v.toLowerCase())
                    );
                    break;
                case 'label':
                case 'labels':
                    matches = values.some(v =>
                        item.labels.some(l => l.name.toLowerCase().includes(v.toLowerCase()))
                    );
                    break;
                case 'type':
                    matches = values.some(v =>
                        item.issueType?.toLowerCase() === v.toLowerCase()
                    );
                    break;
                case 'repo':
                case 'repository':
                    matches = values.some(v =>
                        item.repository?.toLowerCase().includes(v.toLowerCase())
                    );
                    break;
                default:
                    // Check custom fields
                    const fieldValue = item.fields[field] ||
                        Object.entries(item.fields).find(([k]) => k.toLowerCase() === field)?.[1];
                    if (fieldValue) {
                        matches = values.some(v =>
                            fieldValue.toLowerCase().includes(v.toLowerCase())
                        );
                    }
            }

            return negated ? !matches : matches;
        });
    }

    return result;
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
                    if (sc.sort) parts.push(`--sort ${sc.sort}`);
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

    // --view: filter by project view's filter expression
    if (options.view) {
        // Find the view in target projects
        let viewFound = false;
        for (const project of targetProjects) {
            const views = await api.getProjectViews(project.id);
            const view = views.find(v => v.name.toLowerCase() === options.view!.toLowerCase());
            if (view) {
                viewFound = true;
                if (view.filter) {
                    // Parse and apply the view's filter
                    filteredItems = applyViewFilter(filteredItems, view.filter, api.username || '');
                }
                // Only use items from this project for the view
                filteredItems = filteredItems.filter(item => item.projectId === project.id);
                break;
            }
        }
        if (!viewFound) {
            console.error(chalk.red('View not found:'), options.view);
            console.log(chalk.dim('Available views:'));
            for (const project of targetProjects) {
                const views = await api.getProjectViews(project.id);
                for (const v of views) {
                    console.log(`  ${chalk.cyan(v.name)}`);
                }
            }
            process.exit(1);
        }
    }

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

    // --status: filter by status (can be string or array)
    if (options.status) {
        const statusList = Array.isArray(options.status)
            ? options.status.map(s => s.toLowerCase())
            : [options.status.toLowerCase()];
        filteredItems = filteredItems.filter(item =>
            item.status && statusList.includes(item.status.toLowerCase())
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
                if (fieldLower === 'state') {
                    // state can be: open, closed, merged
                    return item.state?.toLowerCase() === valueLower;
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

    // Determine if we need status column (when items have mixed statuses)
    const needsStatusColumn = options.list || options.all || options.view || (options.group && options.group.toLowerCase() !== 'status');
    const defaultColumnsWithStatus: ColumnName[] = ['number', 'type', 'title', 'status', 'assignees', 'priority', 'size', 'labels'];

    // Display based on mode
    if (options.group) {
        // Grouped view - group by specified field
        displayGroupedView(filteredItems, options.group, options);
    } else if (options.list || options.all || options.view) {
        // Table view for all items or view items (includes status column)
        const label = options.view
            ? `View: ${options.view}`
            : options.mine
                ? 'My Items'
                : options.unassigned
                    ? 'Unassigned Items'
                    : 'All Items';
        console.log(chalk.bold(label), chalk.dim(`(${filteredItems.length} items)`));
        console.log();
        const columnsConfig = getConfig('columns');
        const columns: ColumnName[] = columnsConfig ? parseColumns(columnsConfig) : defaultColumnsWithStatus;
        displayTable(filteredItems, columns);
        console.log();
    } else if (options.status) {
        // Table view for status filter
        const statusDisplay = Array.isArray(options.status) ? options.status.join(', ') : options.status;
        const label = options.mine ? `My ${statusDisplay}` : options.unassigned ? `Unassigned ${statusDisplay}` : statusDisplay;
        console.log(chalk.bold(label), chalk.dim(`(${filteredItems.length} items)`));
        console.log();
        const columnsConfig = getConfig('columns');
        const columns: ColumnName[] = columnsConfig ? parseColumns(columnsConfig) : DEFAULT_COLUMNS;
        displayTable(filteredItems, columns);
        console.log();
    } else {
        // Board view
        displayBoardView(filteredItems, targetProjects, options);
    }
}

function getFieldValue(item: ProjectItem, fieldName: string): any {
    const lower = fieldName.toLowerCase();

    // Built-in fields
    switch (lower) {
        case 'number':
            return item.number;
        case 'title':
            return item.title;
        case 'status':
            // Return statusIndex for sorting by project's defined order
            return item.statusIndex;
        case 'type':
            return item.type;
        case 'issuetype':
        case 'issue-type':
        case 'issue_type':
            return item.issueType;
        case 'assignee':
        case 'assignees':
        case 'user':
            // Return first assignee for sorting, or empty string if none
            return item.assignees[0] || '';
        case 'repo':
        case 'repository':
            return item.repository;
        case 'label':
        case 'labels':
            // Return first label name for sorting
            return item.labels[0]?.name || '';
        case 'project':
            return item.projectTitle;
        default:
            // Check custom fields (exact match first, then case-insensitive)
            if (item.fields[fieldName]) {
                return item.fields[fieldName];
            }
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

/**
 * Get display value for a field (for grouping headers, not sorting)
 */
function getFieldDisplayValue(item: ProjectItem, fieldName: string): string {
    const lower = fieldName.toLowerCase();

    switch (lower) {
        case 'status':
            return item.status || 'No Status';
        case 'type':
        case 'issuetype':
        case 'issue-type':
            return item.issueType || 'No Type';
        case 'assignee':
        case 'assignees':
            return item.assignees.length > 0 ? item.assignees.join(', ') : 'Unassigned';
        case 'priority':
            return item.fields['Priority'] || item.fields['priority'] || 'No Priority';
        case 'size':
            return item.fields['Size'] || item.fields['size'] || item.fields['Estimate'] || 'No Size';
        case 'label':
        case 'labels':
            return item.labels.length > 0 ? item.labels.map(l => l.name).join(', ') : 'No Labels';
        case 'project':
            return item.projectTitle;
        case 'repo':
        case 'repository':
            return item.repository || 'Unknown';
        default:
            // Check custom fields
            const fieldValue = item.fields[fieldName] ||
                Object.entries(item.fields).find(([k]) => k.toLowerCase() === lower)?.[1];
            return fieldValue || `No ${fieldName}`;
    }
}

/**
 * Display items grouped by a field
 */
function displayGroupedView(items: ProjectItem[], groupField: string, opts: PlanOptions): void {
    if (items.length === 0) {
        console.log(chalk.dim('No items found.'));
        return;
    }

    // Group items by the field value
    const groups = new Map<string, ProjectItem[]>();
    const groupOrder: string[] = []; // Track order of first appearance

    for (const item of items) {
        const groupValue = getFieldDisplayValue(item, groupField);
        if (!groups.has(groupValue)) {
            groups.set(groupValue, []);
            groupOrder.push(groupValue);
        }
        groups.get(groupValue)!.push(item);
    }

    // Sort groups by the field's natural order (using getFieldValue for sort key)
    // For status, this will use statusIndex; for others, alphabetical
    const lower = groupField.toLowerCase();
    if (lower === 'status') {
        // Sort by statusIndex of first item in each group
        groupOrder.sort((a, b) => {
            const aItem = groups.get(a)![0];
            const bItem = groups.get(b)![0];
            return aItem.statusIndex - bItem.statusIndex;
        });
    } else {
        // Alphabetical, but put "No X" / "Unassigned" at the end
        groupOrder.sort((a, b) => {
            const aIsEmpty = a.startsWith('No ') || a === 'Unassigned';
            const bIsEmpty = b.startsWith('No ') || b === 'Unassigned';
            if (aIsEmpty && !bIsEmpty) return 1;
            if (!aIsEmpty && bIsEmpty) return -1;
            return a.localeCompare(b);
        });
    }

    // Determine columns - exclude the group field from columns
    const columnsConfig = getConfig('columns');
    let columns: ColumnName[] = columnsConfig
        ? parseColumns(columnsConfig)
        : DEFAULT_COLUMNS;

    // Remove the grouped field from columns since it's shown in the header
    const groupFieldLower = groupField.toLowerCase();
    const fieldToColumnMap: Record<string, ColumnName> = {
        'status': 'status',
        'type': 'type',
        'issuetype': 'type',
        'issue-type': 'type',
        'assignee': 'assignees',
        'assignees': 'assignees',
        'priority': 'priority',
        'size': 'size',
        'label': 'labels',
        'labels': 'labels',
        'project': 'project',
        'repo': 'repository',
        'repository': 'repository',
    };
    const columnToRemove = fieldToColumnMap[groupFieldLower];
    if (columnToRemove) {
        columns = columns.filter(c => c !== columnToRemove);
    }

    // Pre-calculate column widths based on ALL items so tables align across groups
    // We do this by getting the max width needed for each column across all items
    const columnWidths = calculateColumnWidths(items, columns);

    // Display each group
    for (const groupValue of groupOrder) {
        const groupItems = groups.get(groupValue)!;
        console.log(chalk.bold.cyan(`■ ${groupValue}`) + chalk.dim(` (${groupItems.length})`));
        console.log();
        displayTableWithWidths(groupItems, columns, columnWidths);
        console.log();
    }
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

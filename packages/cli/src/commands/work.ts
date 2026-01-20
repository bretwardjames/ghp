import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository } from '../git-utils.js';
import { getConfig, getWorkDefaults } from '../config.js';
import { displayTable, parseColumns, DEFAULT_COLUMNS, calculateColumnWidths, displayTableWithWidths, type ColumnName } from '../table.js';
import { getBranchForIssue } from '../branch-linker.js';
import type { ProjectItem, RepoInfo } from '../types.js';

interface WorkOptions {
    all?: boolean;
    mine?: boolean;
    unassigned?: boolean;
    status?: string | string[];
    hideDone?: boolean;
    list?: boolean;
    flat?: boolean;
    group?: string;
    sort?: string;
    slice?: string[];
    filter?: string[];
    project?: string;
}

export async function workCommand(cliOptions: WorkOptions): Promise<void> {
    // Load defaults and merge with CLI options
    // Filter out undefined CLI options so they don't override defaults
    const definedCliOptions = Object.fromEntries(
        Object.entries(cliOptions).filter(([_, v]) => v !== undefined)
    ) as WorkOptions;

    const defaults = getWorkDefaults();
    const options: WorkOptions = {
        ...defaults,
        ...definedCliOptions,
        // Merge slice arrays
        slice: [...(defaults.slice || []), ...(definedCliOptions.slice || [])],
    };
    // CLI status overrides default status (don't merge)
    if (definedCliOptions.status !== undefined) {
        options.status = definedCliOptions.status;
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

    // --mine: filter to only assigned to me (useful with --all)
    if (options.mine) {
        filteredItems = filteredItems.filter(item =>
            item.assignees.includes(api.username || '')
        );
    }

    // --unassigned: filter to unassigned items
    if (options.unassigned) {
        filteredItems = filteredItems.filter(item =>
            item.assignees.length === 0
        );
    }

    // --project: filter to specific project
    if (options.project) {
        filteredItems = filteredItems.filter(item =>
            item.projectTitle.toLowerCase().includes(options.project!.toLowerCase())
        );
    }

    // Filter by status (can be string or array)
    if (options.status) {
        const statusList = Array.isArray(options.status)
            ? options.status.map(s => s.toLowerCase())
            : [options.status.toLowerCase()];
        filteredItems = filteredItems.filter(item =>
            item.status && statusList.includes(item.status.toLowerCase())
        );
    }

    // Hide done items
    if (options.hideDone) {
        filteredItems = filteredItems.filter(item =>
            !['Done', 'Closed', 'Completed'].includes(item.status || '')
        );
    }

    // --slice/--filter: filter by field=value pairs
    const filters = [...(options.slice || []), ...(options.filter || [])];
    if (filters.length > 0) {
        for (const slice of filters) {
            const [field, value] = slice.split('=');
            if (!field || !value) {
                console.error(chalk.red('Invalid filter format:'), slice);
                console.log(chalk.dim('Use: --filter field=value'));
                continue;
            }

            const fieldLower = field.toLowerCase();
            const valueLower = value.toLowerCase();

            filteredItems = filteredItems.filter(item => {
                if (fieldLower === 'assignee' || fieldLower === 'user') {
                    return item.assignees.some(a => a.toLowerCase().includes(valueLower));
                }
                if (fieldLower === 'label') {
                    return item.labels.some(l => l.name.toLowerCase().includes(valueLower));
                }
                if (fieldLower === 'type' || fieldLower === 'issuetype' || fieldLower === 'issue-type') {
                    return item.issueType?.toLowerCase().includes(valueLower) || false;
                }
                if (fieldLower === 'state') {
                    return item.state?.toLowerCase() === valueLower;
                }
                if (fieldLower === 'project') {
                    return item.projectTitle.toLowerCase().includes(valueLower);
                }

                // Check custom project fields
                const fieldValue = item.fields[field] || item.fields[fieldLower];
                if (fieldValue) {
                    return fieldValue.toLowerCase().includes(valueLower);
                }

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

    if (filteredItems.length === 0) {
        if (options.all) {
            console.log(chalk.yellow('No items found.'));
        } else {
            console.log(chalk.yellow('No items assigned to you.'));
            console.log(chalk.dim('Use --all to see all items.'));
        }
        return;
    }

    // Sort items if requested
    if (options.sort) {
        const sortFields = options.sort.split(',').map(f => f.trim());
        filteredItems.sort((a, b) => {
            for (const field of sortFields) {
                const ascending = field.startsWith('-');
                const fieldName = ascending ? field.slice(1) : field;

                let aVal: any = getFieldValue(a, fieldName);
                let bVal: any = getFieldValue(b, fieldName);

                if (aVal === bVal) continue;
                if (aVal === null || aVal === undefined) return ascending ? -1 : 1;
                if (bVal === null || bVal === undefined) return ascending ? 1 : -1;

                if (typeof aVal === 'string' && typeof bVal === 'string') {
                    const cmp = aVal.localeCompare(bVal);
                    return ascending ? cmp : -cmp;
                }

                if (aVal < bVal) return ascending ? -1 : 1;
                if (aVal > bVal) return ascending ? 1 : -1;
            }
            return 0;
        });
    }

    // Simple list output for pickers
    if (options.list) {
        for (const item of filteredItems) {
            const num = item.number ? `#${item.number}` : '';
            const status = item.status ? `[${item.status}]` : '';
            console.log(`${num} ${item.title} ${status}`);
        }
        return;
    }

    // Populate branch link info for display
    await populateBranchLinks(repo, filteredItems);

    // Flat table output
    if (options.flat) {
        const columnsConfig = getConfig('columns');
        const defaultWithStatus: ColumnName[] = ['number', 'branch', 'type', 'title', 'status', 'assignees', 'priority', 'size', 'labels'];
        const columns: ColumnName[] = columnsConfig ? parseColumns(columnsConfig) : defaultWithStatus;
        displayTable(filteredItems, columns);
        return;
    }

    // Grouped display (by specified field or default to status)
    const groupField = options.group || 'status';
    displayGroupedView(filteredItems, groupField);
}

/**
 * Get field value for sorting
 */
function getFieldValue(item: ProjectItem, fieldName: string): any {
    const lower = fieldName.toLowerCase();

    switch (lower) {
        case 'number':
            return item.number;
        case 'title':
            return item.title;
        case 'status':
            return item.statusIndex;
        case 'type':
            return item.type;
        case 'issuetype':
        case 'issue-type':
            return item.issueType;
        case 'assignee':
        case 'assignees':
            return item.assignees[0] || '';
        case 'repo':
        case 'repository':
            return item.repository;
        case 'label':
        case 'labels':
            return item.labels[0]?.name || '';
        case 'project':
            return item.projectTitle;
        default:
            // Check custom fields
            if (item.fields[fieldName]) {
                return item.fields[fieldName];
            }
            const customField = Object.entries(item.fields || {}).find(
                ([k]) => k.toLowerCase() === lower
            );
            return customField ? customField[1] : null;
    }
}

/**
 * Get display value for grouping headers
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
            const fieldValue = item.fields[fieldName] ||
                Object.entries(item.fields).find(([k]) => k.toLowerCase() === lower)?.[1];
            return fieldValue || `No ${fieldName}`;
    }
}

/**
 * Display items grouped by a field with consistent column widths
 */
function displayGroupedView(items: ProjectItem[], groupField: string): void {
    if (items.length === 0) {
        console.log(chalk.dim('No items found.'));
        return;
    }

    // Group items by the field value
    const groups = new Map<string, ProjectItem[]>();
    const groupOrder: string[] = [];

    for (const item of items) {
        const groupValue = getFieldDisplayValue(item, groupField);
        if (!groups.has(groupValue)) {
            groups.set(groupValue, []);
            groupOrder.push(groupValue);
        }
        groups.get(groupValue)!.push(item);
    }

    // Sort groups
    const lower = groupField.toLowerCase();
    if (lower === 'status') {
        groupOrder.sort((a, b) => {
            const aItem = groups.get(a)![0];
            const bItem = groups.get(b)![0];
            return aItem.statusIndex - bItem.statusIndex;
        });
    } else {
        groupOrder.sort((a, b) => {
            const aIsEmpty = a.startsWith('No ') || a === 'Unassigned';
            const bIsEmpty = b.startsWith('No ') || b === 'Unassigned';
            if (aIsEmpty && !bIsEmpty) return 1;
            if (!aIsEmpty && bIsEmpty) return -1;
            return a.localeCompare(b);
        });
    }

    // Determine columns - exclude the group field from display
    const columnsConfig = getConfig('columns');
    let columns: ColumnName[] = columnsConfig
        ? parseColumns(columnsConfig)
        : DEFAULT_COLUMNS;

    // Remove the grouped field from columns
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
    const columnToRemove = fieldToColumnMap[lower];
    if (columnToRemove) {
        columns = columns.filter(c => c !== columnToRemove);
    }

    // Pre-calculate column widths for consistent alignment across groups
    const columnWidths = calculateColumnWidths(items, columns);

    // Display each group
    for (const groupValue of groupOrder) {
        const groupItems = groups.get(groupValue)!;
        console.log(getStatusColor(groupValue)(`■ ${groupValue}`) + chalk.dim(` (${groupItems.length})`));
        console.log();
        displayTableWithWidths(groupItems, columns, columnWidths);
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

/**
 * Populate branch link info for items by fetching from issue bodies.
 * Sets item.fields['linkedBranch'] if a branch is linked.
 */
async function populateBranchLinks(repo: RepoInfo, items: ProjectItem[]): Promise<void> {
    // Only check items that have issue numbers (not drafts)
    const itemsWithNumbers = items.filter(item => item.number !== null);

    // Fetch in parallel with a concurrency limit to avoid rate limiting
    const BATCH_SIZE = 10;
    for (let i = 0; i < itemsWithNumbers.length; i += BATCH_SIZE) {
        const batch = itemsWithNumbers.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (item) => {
            try {
                const linkedBranch = await getBranchForIssue(repo, item.number!);
                if (linkedBranch) {
                    item.fields['linkedBranch'] = linkedBranch;
                }
            } catch {
                // Silently ignore errors fetching branch links
            }
        }));
    }
}

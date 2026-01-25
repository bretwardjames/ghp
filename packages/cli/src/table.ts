import chalk from 'chalk';
import type { ProjectItem } from './types.js';

export type ColumnName =
    | 'number'
    | 'type'
    | 'title'
    | 'assignees'
    | 'status'
    | 'priority'
    | 'size'
    | 'labels'
    | 'project'
    | 'repository'
    | 'branch'
    | 'blocks';

interface ColumnDef {
    header: string;
    getValue: (item: ProjectItem) => string;
    color?: (value: string) => string;
    minWidth?: number;
    maxWidth?: number;
}

const COLUMN_DEFS: Record<ColumnName, ColumnDef> = {
    number: {
        header: '#',
        getValue: (item) => item.number ? `#${item.number}` : 'draft',
        color: (v) => v === 'draft' ? chalk.dim(v) : chalk.cyan(v),
        minWidth: 5,
    },
    type: {
        header: 'Type',
        getValue: (item) => item.issueType || '',
        color: (v) => chalk.yellow(v),
    },
    title: {
        header: 'Title',
        getValue: (item) => item.title,
        minWidth: 20,
        maxWidth: 60,
    },
    assignees: {
        header: 'Assignee',
        getValue: (item) => item.assignees.map(a => '@' + a).join(' '),
        color: (v) => chalk.cyan(v),
    },
    status: {
        header: 'Status',
        getValue: (item) => item.status || '',
        color: (v) => {
            const lower = v.toLowerCase();
            if (lower === 'in progress') return chalk.yellow(v);
            if (lower === 'done' || lower === 'closed' || lower === 'completed') return chalk.green(v);
            if (lower === 'todo' || lower === 'backlog') return chalk.blue(v);
            if (lower === 'in review') return chalk.magenta(v);
            return v;
        },
    },
    priority: {
        header: 'Priority',
        getValue: (item) => item.fields['Priority'] || item.fields['priority'] || '',
        color: (v) => chalk.magenta(v),
    },
    size: {
        header: 'Size',
        getValue: (item) => item.fields['Size'] || item.fields['size'] || item.fields['Estimate'] || item.fields['estimate'] || '',
        color: (v) => chalk.blue(v),
    },
    labels: {
        header: 'Labels',
        getValue: (item) => item.labels.map(l => l.name).join(', '),
        // Labels get special rendering, handled separately
    },
    project: {
        header: 'Project',
        getValue: (item) => item.projectTitle,
        color: (v) => chalk.dim(v),
    },
    repository: {
        header: 'Repo',
        getValue: (item) => item.repository || '',
        color: (v) => chalk.dim(v),
    },
    branch: {
        header: '🌿',
        getValue: (item) => item.fields['linkedBranch'] ? '🔗' : '',
        color: (v) => chalk.cyan(v),
        minWidth: 2,
        maxWidth: 2,
    },
    blocks: {
        header: 'Blocks',
        getValue: (item) => {
            const parts: string[] = [];
            // Show what this issue is blocked by (open issues only)
            const openBlockers = item.blockedBy?.filter(b => b.state === 'OPEN') || [];
            if (openBlockers.length > 0) {
                parts.push(`⛔ ${openBlockers.map(b => '#' + b.number).join(',')}`);
            }
            // Show what this issue is blocking (open issues only)
            const openBlocking = item.blocking?.filter(b => b.state === 'OPEN') || [];
            if (openBlocking.length > 0) {
                parts.push(`→ ${openBlocking.map(b => '#' + b.number).join(',')}`);
            }
            return parts.join(' ');
        },
        color: (v) => v.startsWith('⛔') ? chalk.red(v) : chalk.yellow(v),
        minWidth: 6,
    },
};

// Default column order
export const DEFAULT_COLUMNS: ColumnName[] = ['number', 'branch', 'type', 'title', 'assignees', 'priority', 'size', 'labels'];

function hexToChalk(hex: string): (text: string) => string {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const textColor = luminance > 0.5 ? chalk.black : chalk.white;
    return (text: string) => textColor.bgRgb(r, g, b)(text);
}

export function displayTable(items: ProjectItem[], columns: ColumnName[], options?: { filterEmptyColumns?: boolean }): void {
    if (items.length === 0) {
        console.log(chalk.dim('No items found.'));
        return;
    }

    // Optionally filter to only columns that have data (default: show all columns)
    const activeColumns = options?.filterEmptyColumns
        ? columns.filter(col => {
            if (col === 'title' || col === 'number') return true; // Always show these
            const def = COLUMN_DEFS[col];
            return items.some(item => def.getValue(item) !== '');
        })
        : columns;

    // Build rows with raw data
    const rows = items.map(item => {
        const row: Record<string, string> = {};
        for (const col of activeColumns) {
            row[col] = COLUMN_DEFS[col].getValue(item);
        }
        // Keep labels separate for special rendering
        row._labels = JSON.stringify(item.labels);
        return row;
    });

    // Calculate column widths
    const widths: Record<string, number> = {};
    const termWidth = process.stdout.columns || 120;
    let fixedWidth = 0;

    for (const col of activeColumns) {
        const def = COLUMN_DEFS[col];
        if (col === 'title') continue; // Calculate title last

        const maxContent = Math.max(
            def.header.length,
            ...rows.map(r => r[col].length)
        );
        const width = Math.max(def.minWidth || 0, Math.min(def.maxWidth || 999, maxContent));
        widths[col] = width;
        fixedWidth += width + 2; // +2 for spacing
    }

    // Title gets remaining space
    const titleDef = COLUMN_DEFS.title;
    widths.title = Math.max(
        titleDef.minWidth || 20,
        Math.min(titleDef.maxWidth || 60, termWidth - fixedWidth - 4)
    );

    // Print header
    const headerParts: string[] = [];
    for (const col of activeColumns) {
        const def = COLUMN_DEFS[col];
        headerParts.push(chalk.dim(def.header.padEnd(widths[col])));
    }
    console.log(`  ${headerParts.join('  ')}`);
    console.log(chalk.dim('  ' + '─'.repeat(Math.min(termWidth - 4, Object.values(widths).reduce((a, b) => a + b, 0) + (activeColumns.length - 1) * 2))));

    // Print rows
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const item = items[i];
        const parts: string[] = [];

        for (const col of activeColumns) {
            const def = COLUMN_DEFS[col];
            let value = row[col];

            // Handle title truncation
            if (col === 'title' && value.length > widths[col]) {
                value = value.substring(0, widths[col] - 1) + '…';
            }

            // Apply color if defined (except labels which are special)
            if (col !== 'labels') {
                const padded = value.padEnd(widths[col]);
                parts.push(def.color ? def.color(padded) : padded);
            }
        }

        // Handle labels separately with colored backgrounds
        if (activeColumns.includes('labels') && item.labels.length > 0) {
            const labelStr = item.labels.map(l => {
                const bg = hexToChalk(l.color);
                return bg(` ${l.name} `);
            }).join(' ');
            parts.push(labelStr);
        }

        console.log(`  ${parts.join('  ')}`);
    }
}

export function parseColumns(columnsStr: string): ColumnName[] {
    const validColumns = Object.keys(COLUMN_DEFS) as ColumnName[];
    return columnsStr
        .split(',')
        .map(c => c.trim().toLowerCase() as ColumnName)
        .filter(c => validColumns.includes(c));
}

/**
 * Calculate column widths based on all items (for consistent widths across grouped tables)
 */
export function calculateColumnWidths(items: ProjectItem[], columns: ColumnName[]): Record<string, number> {
    const widths: Record<string, number> = {};
    const termWidth = process.stdout.columns || 120;
    let fixedWidth = 0;

    for (const col of columns) {
        const def = COLUMN_DEFS[col];
        if (col === 'title') continue; // Calculate title last

        const maxContent = Math.max(
            def.header.length,
            ...items.map(item => def.getValue(item).length)
        );
        const width = Math.max(def.minWidth || 0, Math.min(def.maxWidth || 999, maxContent));
        widths[col] = width;
        fixedWidth += width + 2; // +2 for spacing
    }

    // Title gets remaining space
    const titleDef = COLUMN_DEFS.title;
    widths.title = Math.max(
        titleDef.minWidth || 20,
        Math.min(titleDef.maxWidth || 60, termWidth - fixedWidth - 4)
    );

    return widths;
}

/**
 * Display table with pre-calculated column widths (for consistent alignment across groups)
 */
export function displayTableWithWidths(items: ProjectItem[], columns: ColumnName[], widths: Record<string, number>): void {
    if (items.length === 0) {
        console.log(chalk.dim('No items found.'));
        return;
    }

    const termWidth = process.stdout.columns || 120;

    // Print header
    const headerParts: string[] = [];
    for (const col of columns) {
        const def = COLUMN_DEFS[col];
        headerParts.push(chalk.dim(def.header.padEnd(widths[col])));
    }
    console.log(`  ${headerParts.join('  ')}`);
    console.log(chalk.dim('  ' + '─'.repeat(Math.min(termWidth - 4, Object.values(widths).reduce((a, b) => a + b, 0) + (columns.length - 1) * 2))));

    // Print rows
    for (const item of items) {
        const parts: string[] = [];

        for (const col of columns) {
            const def = COLUMN_DEFS[col];
            let value = def.getValue(item);

            // Handle title truncation
            if (col === 'title' && value.length > widths[col]) {
                value = value.substring(0, widths[col] - 1) + '…';
            }

            // Apply color if defined (except labels which are special)
            if (col !== 'labels') {
                const padded = value.padEnd(widths[col]);
                parts.push(def.color ? def.color(padded) : padded);
            }
        }

        // Handle labels separately with colored backgrounds
        if (columns.includes('labels') && item.labels.length > 0) {
            const labelStr = item.labels.map(l => {
                const bg = hexToChalk(l.color);
                return bg(` ${l.name} `);
            }).join(' ');
            parts.push(labelStr);
        } else if (columns.includes('labels')) {
            // Empty labels column - add padding
            parts.push(''.padEnd(widths['labels'] || 0));
        }

        console.log(`  ${parts.join('  ')}`);
    }
}

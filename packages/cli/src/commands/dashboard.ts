/**
 * Dashboard command - Show comprehensive view of branch changes
 *
 * Displays:
 * - Commit history since branching from main
 * - Diff statistics (files changed, insertions, deletions)
 * - Changed files list
 * - Full diff (optional)
 * - External hook results (grouped by category)
 */

import chalk from 'chalk';
import {
    gatherDashboardData,
    getDashboardCurrentBranch as getCurrentBranch,
    getDefaultBaseBranch,
    getEnabledHooks,
    getGitHubRepo,
    executeAllHooks,
    type BranchDashboardData,
    type Commit,
    type DiffStats,
    type FileChange,
    type HookExecutionResult,
    type HookItem,
} from '@bretwardjames/ghp-core';
import { getConfig } from '../config.js';

export interface DashboardOptions {
    diff?: boolean;
    stats?: boolean;
    commits?: boolean;
    files?: boolean;
    base?: string;
    maxDiffLines?: number;
    json?: boolean;
}

/**
 * Format a commit for display
 */
function formatCommit(commit: Commit): string {
    const hashColor = chalk.yellow(commit.shortHash);
    const subject = commit.subject;
    return `  ${hashColor} ${subject}`;
}

/**
 * Format diff stats header
 */
function formatStatsHeader(stats: DiffStats): string {
    const parts = [];

    if (stats.filesChanged > 0) {
        parts.push(chalk.cyan(`${stats.filesChanged} file${stats.filesChanged !== 1 ? 's' : ''} changed`));
    }

    if (stats.insertions > 0) {
        parts.push(chalk.green(`+${stats.insertions}`));
    }

    if (stats.deletions > 0) {
        parts.push(chalk.red(`-${stats.deletions}`));
    }

    return parts.join(', ');
}

/**
 * Format a file change for display
 */
function formatFileChange(file: FileChange): string {
    let statusIcon: string;
    let color: typeof chalk;

    switch (file.status) {
        case 'added':
            statusIcon = '+';
            color = chalk.green;
            break;
        case 'deleted':
            statusIcon = '-';
            color = chalk.red;
            break;
        case 'renamed':
            statusIcon = '→';
            color = chalk.blue;
            break;
        default:
            statusIcon = '~';
            color = chalk.yellow;
    }

    return `  ${color(statusIcon)} ${file.path}`;
}

/**
 * Render the dashboard to the terminal
 */
function renderDashboard(data: BranchDashboardData, options: DashboardOptions): void {
    const showAll = !options.diff && !options.stats && !options.commits && !options.files;

    // Header
    console.log();
    console.log(chalk.bold.cyan('Branch Dashboard'));
    console.log(chalk.dim(`${data.branch} ← ${data.baseBranch}`));
    console.log();

    // Stats summary
    if (showAll || options.stats) {
        if (data.stats.filesChanged === 0) {
            console.log(chalk.dim('No changes from base branch'));
        } else {
            console.log(formatStatsHeader(data.stats));
        }
        console.log();
    }

    // Commits
    if ((showAll || options.commits) && data.commits.length > 0) {
        console.log(chalk.bold(`Commits (${data.commits.length})`));
        console.log(chalk.dim('─'.repeat(50)));
        for (const commit of data.commits) {
            console.log(formatCommit(commit));
        }
        console.log();
    }

    // Changed files
    if ((showAll || options.files) && data.stats.files.length > 0) {
        console.log(chalk.bold('Changed Files'));
        console.log(chalk.dim('─'.repeat(50)));
        for (const file of data.stats.files) {
            console.log(formatFileChange(file));
        }
        console.log();
    }

    // Full diff (only if explicitly requested)
    if (options.diff && data.diff) {
        console.log(chalk.bold('Diff'));
        console.log(chalk.dim('─'.repeat(50)));
        // Basic syntax highlighting for diff
        const lines = data.diff.split('\n');
        for (const line of lines) {
            if (line.startsWith('+') && !line.startsWith('+++')) {
                console.log(chalk.green(line));
            } else if (line.startsWith('-') && !line.startsWith('---')) {
                console.log(chalk.red(line));
            } else if (line.startsWith('@@')) {
                console.log(chalk.cyan(line));
            } else if (line.startsWith('diff ') || line.startsWith('index ')) {
                console.log(chalk.dim(line));
            } else {
                console.log(line);
            }
        }
        console.log();
    }
}

/**
 * Format a hook item for display
 */
function formatHookItem(item: HookItem): string {
    const parts = [`  - ${item.title}`];

    if (item.summary) {
        parts.push(chalk.dim(` - ${item.summary}`));
    }

    if (item.timestamp) {
        parts.push(chalk.dim(` (${item.timestamp})`));
    }

    return parts.join('');
}

/**
 * Render hook execution results grouped by category
 */
function renderHookResults(results: HookExecutionResult[]): void {
    if (results.length === 0) {
        return;
    }

    // Group results by category
    const byCategory = new Map<string, HookExecutionResult[]>();
    for (const result of results) {
        const category = result.hook.category || 'other';
        if (!byCategory.has(category)) {
            byCategory.set(category, []);
        }
        byCategory.get(category)!.push(result);
    }

    // Render each category
    for (const [category, categoryResults] of byCategory) {
        // Category header
        const categoryTitle = category.charAt(0).toUpperCase() + category.slice(1);
        console.log(chalk.bold.magenta(`${categoryTitle}`));
        console.log(chalk.dim('─'.repeat(50)));

        for (const result of categoryResults) {
            const hookName = result.hook.displayName || result.hook.name;

            if (result.success && result.data) {
                // Successful hook - show title and items
                console.log(chalk.bold(`${hookName}: ${result.data.title}`));

                if (result.data.items.length === 0) {
                    console.log(chalk.dim('  (no items)'));
                } else {
                    for (const item of result.data.items) {
                        console.log(formatHookItem(item));
                    }
                }
            } else {
                // Failed hook - show dim error message (don't fail entire dashboard)
                console.log(chalk.dim(`${hookName}: ${result.error || 'Unknown error'}`));
            }
        }

        console.log();
    }
}

/**
 * Main dashboard command
 */
export async function dashboardCommand(options: DashboardOptions = {}): Promise<void> {
    const branch = await getCurrentBranch();
    if (!branch) {
        console.error(chalk.red('Error:'), 'Not in a git repository');
        process.exit(1);
    }

    // Get base branch from options, config, or detect
    const baseBranch = options.base || getConfig('mainBranch') || await getDefaultBaseBranch();

    console.log(chalk.dim('Gathering branch data...'));

    // Get enabled hooks and repo info
    const enabledHooks = getEnabledHooks();
    const repo = await getGitHubRepo() || 'unknown/unknown';

    // Execute dashboard data gathering and hooks in parallel
    const [data, hookResults] = await Promise.all([
        gatherDashboardData({
            baseBranch,
            includeDiff: options.diff,
            maxDiffLines: options.maxDiffLines || 500,
        }),
        enabledHooks.length > 0
            ? executeAllHooks(enabledHooks, branch, repo)
            : Promise.resolve([]),
    ]);

    if (!data) {
        console.error(chalk.red('Error:'), 'Failed to gather dashboard data');
        process.exit(1);
    }

    // Clear the "Gathering..." line (only in TTY)
    if (process.stdout.isTTY) {
        process.stdout.write('\x1b[1A\x1b[2K');
    }

    // JSON output mode
    if (options.json) {
        const jsonOutput = {
            branch: data.branch,
            baseBranch: data.baseBranch,
            stats: {
                filesChanged: data.stats.filesChanged,
                insertions: data.stats.insertions,
                deletions: data.stats.deletions,
            },
            files: data.stats.files.map((f) => ({
                path: f.path,
                status: f.status,
                insertions: f.insertions,
                deletions: f.deletions,
            })),
            commits: data.commits.map((c) => ({
                hash: c.shortHash,
                subject: c.subject,
                author: c.author,
                date: c.date,
            })),
            hooks: hookResults.map((r) => ({
                name: r.hook.displayName || r.hook.name,
                category: r.hook.category || 'other',
                success: r.success,
                data: r.data,
                error: r.error,
            })),
        };
        console.log(JSON.stringify(jsonOutput, null, 2));
        return;
    }

    renderDashboard(data, options);

    // Render hook results after main dashboard content
    renderHookResults(hookResults);
}

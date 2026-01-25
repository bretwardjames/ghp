/**
 * Branch Dashboard - Core functions for gathering branch data
 *
 * Provides a comprehensive view of work done on a branch:
 * - Commit history
 * - Diff statistics
 * - Changed files
 * - Full diff (optional)
 * - Hook execution for external content providers
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import {
    getCurrentBranch as gitGetCurrentBranch,
    getDefaultBranch as gitGetDefaultBranch,
} from '../git-utils.js';
import type { DashboardHook, HookItem, HookResponse } from './hooks.js';

const execAsync = promisify(exec);

// Debug logging helper
const debug = (message: string, error?: unknown) => {
    if (process.env.DEBUG || process.env.GHP_DEBUG) {
        console.error(`[dashboard] ${message}`, error || '');
    }
};

export interface DiffStats {
    filesChanged: number;
    insertions: number;
    deletions: number;
    files: FileChange[];
}

export interface FileChange {
    path: string;
    insertions: number;
    deletions: number;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
}

export interface Commit {
    hash: string;
    shortHash: string;
    subject: string;
    author: string;
    date: string;
}

export interface BranchDashboardData {
    branch: string;
    baseBranch: string;
    commits: Commit[];
    stats: DiffStats;
    diff?: string;
}

export interface DashboardOptions {
    baseBranch?: string;
    includeDiff?: boolean;
    maxDiffLines?: number;
}

/**
 * Validate branch name to prevent command injection.
 * Valid branch names contain only alphanumeric, dash, underscore, dot, and forward slash.
 */
function isValidBranchName(name: string): boolean {
    return /^[\w\-\.\/]+$/.test(name) && name.length > 0 && name.length < 256;
}

/**
 * Sanitize and validate branch name, throwing if invalid.
 */
function validateBranchName(name: string): string {
    if (!isValidBranchName(name)) {
        throw new Error(`Invalid branch name: ${name}`);
    }
    return name;
}

/**
 * Get the current git branch name.
 * Re-exports from git-utils for convenience.
 */
export async function getCurrentBranch(): Promise<string | null> {
    return gitGetCurrentBranch();
}

/**
 * Get the default base branch (main or master).
 * Re-exports from git-utils for convenience.
 */
export async function getDefaultBaseBranch(): Promise<string> {
    return gitGetDefaultBranch();
}

/**
 * Get commit history between base branch and HEAD
 */
export async function getCommitHistory(baseBranch: string): Promise<Commit[]> {
    try {
        const safeBranch = validateBranchName(baseBranch);
        // Format: hash|short|subject|author|date
        const format = '%H|%h|%s|%an|%ai';
        const { stdout } = await execAsync(
            `git log ${safeBranch}..HEAD --format="${format}"`
        );

        if (!stdout.trim()) {
            return [];
        }

        return stdout
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => {
                const [hash, shortHash, subject, author, date] = line.split('|');
                return { hash, shortHash, subject, author, date };
            });
    } catch (error) {
        debug('Failed to get commit history', error);
        return [];
    }
}

/**
 * Parse git diff --stat output into structured data
 */
function parseDiffStat(statOutput: string): DiffStats {
    const lines = statOutput.trim().split('\n').filter(Boolean);
    const files: FileChange[] = [];
    let totalInsertions = 0;
    let totalDeletions = 0;

    // Parse each file line (all except the summary line)
    for (const line of lines.slice(0, -1)) {
        // Format: " path/to/file.ts | 10 ++++----"
        const match = line.match(/^\s*(.+?)\s+\|\s+(\d+)\s*([+-]*)/);
        if (match) {
            const [, path, , indicators] = match;
            const insertions = (indicators.match(/\+/g) || []).length;
            const deletions = (indicators.match(/-/g) || []).length;

            // Determine status from the path or indicators
            let status: FileChange['status'] = 'modified';
            if (path.includes('=>')) {
                status = 'renamed';
            }

            files.push({
                path: path.trim(),
                insertions,
                deletions,
                status,
            });

            totalInsertions += insertions;
            totalDeletions += deletions;
        }
    }

    // Parse summary line for accurate totals
    // Format: " 5 files changed, 100 insertions(+), 20 deletions(-)"
    const summaryLine = lines[lines.length - 1] || '';
    const summaryMatch = summaryLine.match(
        /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/
    );

    if (summaryMatch) {
        totalInsertions = parseInt(summaryMatch[2] || '0', 10);
        totalDeletions = parseInt(summaryMatch[3] || '0', 10);
    }

    return {
        filesChanged: files.length,
        insertions: totalInsertions,
        deletions: totalDeletions,
        files,
    };
}

/**
 * Get file statuses (added, modified, deleted, renamed)
 */
async function getFileStatuses(baseBranch: string): Promise<Map<string, FileChange['status']>> {
    const statusMap = new Map<string, FileChange['status']>();
    try {
        const safeBranch = validateBranchName(baseBranch);
        const { stdout } = await execAsync(
            `git diff --name-status ${safeBranch}...HEAD`
        );

        for (const line of stdout.trim().split('\n').filter(Boolean)) {
            const [statusChar, ...pathParts] = line.split('\t');
            const path = pathParts.join('\t');

            let status: FileChange['status'] = 'modified';
            switch (statusChar.charAt(0)) {
                case 'A':
                    status = 'added';
                    break;
                case 'D':
                    status = 'deleted';
                    break;
                case 'R':
                    status = 'renamed';
                    break;
            }
            statusMap.set(path, status);
        }
    } catch (error) {
        debug('Failed to get file statuses', error);
    }
    return statusMap;
}

/**
 * Get diff statistics between base branch and HEAD
 */
export async function getDiffStats(baseBranch: string): Promise<DiffStats> {
    try {
        const safeBranch = validateBranchName(baseBranch);
        const [statOutput, fileStatuses] = await Promise.all([
            execAsync(`git diff --stat ${safeBranch}...HEAD`),
            getFileStatuses(baseBranch),
        ]);

        const stats = parseDiffStat(statOutput.stdout);

        // Merge file statuses into stats
        for (const file of stats.files) {
            const status = fileStatuses.get(file.path);
            if (status) {
                file.status = status;
            }
        }

        return stats;
    } catch (error) {
        debug('Failed to get diff stats', error);
        return {
            filesChanged: 0,
            insertions: 0,
            deletions: 0,
            files: [],
        };
    }
}

/**
 * Get the full diff between base branch and HEAD
 */
export async function getFullDiff(
    baseBranch: string,
    maxLines?: number
): Promise<string> {
    try {
        const safeBranch = validateBranchName(baseBranch);
        const { stdout } = await execAsync(`git diff ${safeBranch}...HEAD`);

        if (maxLines && stdout.split('\n').length > maxLines) {
            const lines = stdout.split('\n').slice(0, maxLines);
            return lines.join('\n') + `\n\n... (truncated, ${stdout.split('\n').length - maxLines} more lines)`;
        }

        return stdout;
    } catch (error) {
        debug('Failed to get full diff', error);
        return '';
    }
}

/**
 * Get changed file paths with their status
 */
export async function getChangedFiles(baseBranch: string): Promise<FileChange[]> {
    try {
        const safeBranch = validateBranchName(baseBranch);
        // --name-status gives us: A/M/D/R followed by path
        const { stdout } = await execAsync(
            `git diff --name-status ${safeBranch}...HEAD`
        );

        if (!stdout.trim()) {
            return [];
        }

        return stdout
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => {
                const [statusChar, ...pathParts] = line.split('\t');
                const path = pathParts.join('\t'); // Handle paths with tabs

                let status: FileChange['status'] = 'modified';
                switch (statusChar.charAt(0)) {
                    case 'A':
                        status = 'added';
                        break;
                    case 'D':
                        status = 'deleted';
                        break;
                    case 'R':
                        status = 'renamed';
                        break;
                    case 'M':
                    default:
                        status = 'modified';
                }

                return {
                    path,
                    insertions: 0, // Would need numstat for this
                    deletions: 0,
                    status,
                };
            });
    } catch (error) {
        debug('Failed to get changed files', error);
        return [];
    }
}

/**
 * Gather all dashboard data for the current branch
 */
export async function gatherDashboardData(
    options: DashboardOptions = {}
): Promise<BranchDashboardData | null> {
    const branch = await getCurrentBranch();
    if (!branch) {
        return null;
    }

    const baseBranch = options.baseBranch || (await getDefaultBaseBranch());

    const [commits, stats] = await Promise.all([
        getCommitHistory(baseBranch),
        getDiffStats(baseBranch),
    ]);

    const data: BranchDashboardData = {
        branch,
        baseBranch,
        commits,
        stats,
    };

    if (options.includeDiff) {
        data.diff = await getFullDiff(baseBranch, options.maxDiffLines);
    }

    return data;
}

// =============================================================================
// Hook Execution
// =============================================================================

/**
 * Result of executing a dashboard hook
 */
export interface HookExecutionResult {
    /** The hook that was executed */
    hook: DashboardHook;
    /** Whether execution succeeded */
    success: boolean;
    /** Data returned by the hook (if successful) */
    data?: { title: string; items: HookItem[] };
    /** Error message (if failed) */
    error?: string;
    /** Execution duration in milliseconds */
    duration: number;
}

/**
 * Shell escape a string to prevent command injection.
 * Uses single quotes with escaped single quotes inside.
 */
function shellEscape(str: string): string {
    // Replace single quotes with '\'' (end quote, escaped quote, start quote)
    return `'${str.replace(/'/g, "'\\''")}'`;
}

/**
 * Get the GitHub repository identifier (owner/repo) from git remote.
 */
export async function getGitHubRepo(): Promise<string | null> {
    try {
        const { stdout } = await execAsync('git remote get-url origin');
        const url = stdout.trim();

        // Handle SSH URLs: git@github.com:owner/repo.git
        const sshMatch = url.match(/git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
        if (sshMatch) {
            return sshMatch[1];
        }

        // Handle HTTPS URLs: https://github.com/owner/repo.git
        const httpsMatch = url.match(/https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
        if (httpsMatch) {
            return httpsMatch[1];
        }

        return null;
    } catch (error) {
        debug('Failed to get GitHub repo', error);
        return null;
    }
}

/**
 * Execute a single dashboard hook
 */
export async function executeHook(
    hook: DashboardHook,
    branch: string,
    repo: string
): Promise<HookExecutionResult> {
    const startTime = Date.now();
    const timeout = hook.timeout ?? 5000;

    try {
        // Build command with shell-escaped arguments
        const command = `${hook.command} --branch ${shellEscape(branch)} --repo ${shellEscape(repo)}`;

        debug(`Executing hook "${hook.name}": ${command}`);

        const { stdout } = await execAsync(command, { timeout });

        // Parse JSON output
        let response: HookResponse;
        try {
            response = JSON.parse(stdout) as HookResponse;
        } catch (parseError) {
            return {
                hook,
                success: false,
                error: `Invalid JSON output: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
                duration: Date.now() - startTime,
            };
        }

        // Validate response has success boolean
        if (typeof response.success !== 'boolean') {
            return {
                hook,
                success: false,
                error: 'Hook response missing "success" boolean field',
                duration: Date.now() - startTime,
            };
        }

        // Return failed hook response
        if (!response.success) {
            return {
                hook,
                success: false,
                error: response.error || 'Hook reported failure without error message',
                duration: Date.now() - startTime,
            };
        }

        // Validate successful response has data
        if (!response.data || !response.data.title || !Array.isArray(response.data.items)) {
            return {
                hook,
                success: false,
                error: 'Hook succeeded but returned invalid data structure',
                duration: Date.now() - startTime,
            };
        }

        return {
            hook,
            success: true,
            data: response.data,
            duration: Date.now() - startTime,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isTimeout = errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timed out');

        return {
            hook,
            success: false,
            error: isTimeout ? `Hook timed out after ${timeout}ms` : errorMessage,
            duration: Date.now() - startTime,
        };
    }
}

/**
 * Execute all provided hooks in parallel
 */
export async function executeAllHooks(
    hooks: DashboardHook[],
    branch: string,
    repo: string
): Promise<HookExecutionResult[]> {
    if (hooks.length === 0) {
        return [];
    }

    debug(`Executing ${hooks.length} hooks in parallel`);

    return Promise.all(
        hooks.map((hook) => executeHook(hook, branch, repo))
    );
}

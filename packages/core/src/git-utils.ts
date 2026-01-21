/**
 * Git utility functions for working with local repositories.
 *
 * All functions accept an optional `options.cwd` parameter to specify
 * the working directory. This makes the library usable in both CLI
 * contexts (process.cwd()) and IDE contexts (workspace folder).
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { RepoInfo, GitOptions } from './types.js';
import { parseGitHubUrl } from './url-parser.js';

const execAsync = promisify(exec);

/**
 * Execute a git command in the specified directory
 */
async function execGit(
    command: string,
    options: GitOptions = {}
): Promise<{ stdout: string; stderr: string }> {
    const cwd = options.cwd || process.cwd();
    return execAsync(command, { cwd });
}

/**
 * Detect the GitHub repository from the current directory's git remote
 */
export async function detectRepository(options: GitOptions = {}): Promise<RepoInfo | null> {
    try {
        const { stdout } = await execGit('git remote get-url origin', options);
        const url = stdout.trim();
        return parseGitHubUrl(url);
    } catch {
        return null;
    }
}

/**
 * Get the current git branch
 */
export async function getCurrentBranch(options: GitOptions = {}): Promise<string | null> {
    try {
        const { stdout } = await execGit('git branch --show-current', options);
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

/**
 * Check if there are uncommitted changes
 */
export async function hasUncommittedChanges(options: GitOptions = {}): Promise<boolean> {
    try {
        const { stdout } = await execGit('git status --porcelain', options);
        return stdout.trim().length > 0;
    } catch {
        return false;
    }
}

/**
 * Check if a branch exists locally
 */
export async function branchExists(
    branchName: string,
    options: GitOptions = {}
): Promise<boolean> {
    try {
        await execGit(`git show-ref --verify --quiet refs/heads/${branchName}`, options);
        return true;
    } catch {
        return false;
    }
}

/**
 * Create and checkout a new branch
 */
export async function createBranch(
    branchName: string,
    options: GitOptions = {}
): Promise<void> {
    await execGit(`git checkout -b "${branchName}"`, options);
}

/**
 * Checkout an existing branch
 */
export async function checkoutBranch(
    branchName: string,
    options: GitOptions = {}
): Promise<void> {
    await execGit(`git checkout "${branchName}"`, options);
}

/**
 * Pull latest from origin
 */
export async function pullLatest(options: GitOptions = {}): Promise<void> {
    await execGit('git pull', options);
}

/**
 * Fetch from origin
 */
export async function fetchOrigin(options: GitOptions = {}): Promise<void> {
    await execGit('git fetch origin', options);
}

/**
 * Get number of commits behind origin
 */
export async function getCommitsBehind(
    branch: string,
    options: GitOptions = {}
): Promise<number> {
    try {
        await fetchOrigin(options);
        const { stdout } = await execGit(
            `git rev-list --count ${branch}..origin/${branch}`,
            options
        );
        return parseInt(stdout.trim(), 10) || 0;
    } catch {
        return 0;
    }
}

/**
 * Get number of commits ahead of origin
 */
export async function getCommitsAhead(
    branch: string,
    options: GitOptions = {}
): Promise<number> {
    try {
        await fetchOrigin(options);
        const { stdout } = await execGit(
            `git rev-list --count origin/${branch}..${branch}`,
            options
        );
        return parseInt(stdout.trim(), 10) || 0;
    } catch {
        return 0;
    }
}

/**
 * Check if working directory is a git repository
 */
export async function isGitRepository(options: GitOptions = {}): Promise<boolean> {
    try {
        await execGit('git rev-parse --git-dir', options);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get the root directory of the git repository
 */
export async function getRepositoryRoot(options: GitOptions = {}): Promise<string | null> {
    try {
        const { stdout } = await execGit('git rev-parse --show-toplevel', options);
        return stdout.trim();
    } catch {
        return null;
    }
}

/**
 * Sanitize a string for use in a branch name
 */
export function sanitizeForBranchName(str: string): string {
    return str
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 50);
}

/**
 * Generate a branch name from a pattern
 */
export function generateBranchName(
    pattern: string,
    vars: { user: string; number: number | null; title: string; repo: string },
    maxLength: number = 60
): string {
    const sanitizedTitle = sanitizeForBranchName(vars.title);

    let branch = pattern
        .replace('{user}', vars.user)
        .replace('{number}', vars.number?.toString() || 'draft')
        .replace('{title}', sanitizedTitle)
        .replace('{repo}', vars.repo);

    if (branch.length > maxLength) {
        branch = branch.substring(0, maxLength).replace(/-$/, '');
    }

    return branch;
}

/**
 * Get all local branches
 */
export async function getLocalBranches(options: GitOptions = {}): Promise<string[]> {
    try {
        const { stdout } = await execGit('git branch --format="%(refname:short)"', options);
        return stdout
            .split('\n')
            .map(b => b.trim())
            .filter(b => b.length > 0);
    } catch {
        return [];
    }
}

/**
 * Get all remote branches (excluding HEAD), stripped of origin/ prefix
 */
export async function getRemoteBranches(options: GitOptions = {}): Promise<string[]> {
    try {
        // Fetch to get latest remote branches
        await execGit('git fetch --prune', options);

        const { stdout } = await execGit('git branch -r --format="%(refname:short)"', options);
        return stdout
            .split('\n')
            .map(b => b.trim())
            .filter(b => b.length > 0 && !b.includes('HEAD'))
            .map(b => b.replace(/^origin\//, '')); // Strip origin/ prefix
    } catch {
        return [];
    }
}

/**
 * Get all branches (local + remote unique)
 */
export async function getAllBranches(options: GitOptions = {}): Promise<string[]> {
    const [local, remote] = await Promise.all([
        getLocalBranches(options),
        getRemoteBranches(options),
    ]);

    // Combine and deduplicate, with local branches first
    const all = new Set<string>(local);
    for (const b of remote) {
        all.add(b);
    }
    return Array.from(all);
}

/**
 * Get the default branch name (main or master)
 */
export async function getDefaultBranch(options: GitOptions = {}): Promise<string> {
    try {
        // Try to get from remote HEAD
        const { stdout } = await execGit(
            'git symbolic-ref refs/remotes/origin/HEAD',
            options
        );
        const ref = stdout.trim();
        const match = ref.match(/refs\/remotes\/origin\/(.+)/);
        if (match) {
            return match[1];
        }
    } catch {
        // Fall back to checking if main or master exists
    }

    // Check if 'main' branch exists
    if (await branchExists('main', options)) {
        return 'main';
    }

    // Default to master
    return 'master';
}

// =============================================================================
// Worktree Operations
// =============================================================================

/**
 * Information about a git worktree
 */
export interface WorktreeInfo {
    /** Absolute path to the worktree directory */
    path: string;
    /** Commit SHA the worktree is at */
    head: string;
    /** Branch name (without refs/heads/ prefix), or null if detached */
    branch: string | null;
    /** Whether this is the main worktree (the original repo) */
    isMain: boolean;
}

/**
 * Create a new worktree for a branch
 * @param worktreePath - Path where the worktree will be created
 * @param branch - Branch to checkout in the worktree
 * @param options - Git options (cwd determines the source repository)
 */
export async function createWorktree(
    worktreePath: string,
    branch: string,
    options: GitOptions = {}
): Promise<void> {
    // Check if branch exists locally first
    const localExists = await branchExists(branch, options);

    if (localExists) {
        // Branch exists locally - create worktree from it
        await execGit(`git worktree add "${worktreePath}" "${branch}"`, options);
    } else {
        // Try to create from remote tracking branch
        try {
            await execGit(`git worktree add "${worktreePath}" -b "${branch}" "origin/${branch}"`, options);
        } catch {
            // If remote branch doesn't exist either, create a new branch from current HEAD
            await execGit(`git worktree add -b "${branch}" "${worktreePath}"`, options);
        }
    }
}

/**
 * Remove a worktree
 * @param worktreePath - Path to the worktree to remove
 * @param options - Git options
 * @param force - Force removal even if worktree has uncommitted changes
 */
export async function removeWorktree(
    worktreePath: string,
    options: GitOptions = {},
    force: boolean = false
): Promise<void> {
    const forceFlag = force ? '--force' : '';
    await execGit(`git worktree remove ${forceFlag} "${worktreePath}"`, options);
}

/**
 * List all worktrees for the repository
 * @param options - Git options
 * @returns Array of worktree information
 */
export async function listWorktrees(options: GitOptions = {}): Promise<WorktreeInfo[]> {
    try {
        const { stdout } = await execGit('git worktree list --porcelain', options);
        const worktrees: WorktreeInfo[] = [];

        // Parse porcelain output - each worktree is separated by a blank line
        const entries = stdout.trim().split('\n\n');

        for (const entry of entries) {
            if (!entry.trim()) continue;

            const lines = entry.split('\n');
            const info: Partial<WorktreeInfo> = {
                isMain: false,
                branch: null,
            };

            for (const line of lines) {
                if (line.startsWith('worktree ')) {
                    info.path = line.substring(9);
                } else if (line.startsWith('HEAD ')) {
                    info.head = line.substring(5);
                } else if (line.startsWith('branch ')) {
                    // Remove refs/heads/ prefix
                    info.branch = line.substring(7).replace(/^refs\/heads\//, '');
                } else if (line === 'bare') {
                    info.isMain = true;
                }
            }

            // First worktree is the main one
            if (worktrees.length === 0) {
                info.isMain = true;
            }

            if (info.path && info.head) {
                worktrees.push(info as WorktreeInfo);
            }
        }

        return worktrees;
    } catch {
        return [];
    }
}

/**
 * Get worktree for a specific branch
 * @param branch - Branch name to find
 * @param options - Git options
 * @returns Worktree info if found, null otherwise
 */
export async function getWorktreeForBranch(
    branch: string,
    options: GitOptions = {}
): Promise<WorktreeInfo | null> {
    const worktrees = await listWorktrees(options);
    return worktrees.find(wt => wt.branch === branch) || null;
}

/**
 * Check if a worktree exists at the given path
 * @param worktreePath - Path to check
 * @param options - Git options
 */
export async function worktreeExists(
    worktreePath: string,
    options: GitOptions = {}
): Promise<boolean> {
    const worktrees = await listWorktrees(options);
    return worktrees.some(wt => wt.path === worktreePath);
}

/**
 * Generate a worktree path based on repo and branch info
 * @param basePath - Base directory for worktrees (e.g., ~/.ghp/worktrees)
 * @param repoName - Repository name
 * @param identifier - Issue number or branch name to use as identifier
 * @returns Full path to the worktree directory
 */
export function generateWorktreePath(
    basePath: string,
    repoName: string,
    identifier: string | number
): string {
    // Expand ~ to home directory
    const expandedBase = basePath.startsWith('~')
        ? basePath.replace('~', process.env.HOME || '')
        : basePath;

    // Join path segments, handling trailing slashes
    const cleanBase = expandedBase.replace(/\/+$/, '');
    return `${cleanBase}/${repoName}/${String(identifier)}`;
}

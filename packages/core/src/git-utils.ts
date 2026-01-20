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

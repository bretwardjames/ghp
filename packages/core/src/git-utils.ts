/**
 * Git utility functions for working with local repositories.
 *
 * All functions accept an optional `options.cwd` parameter to specify
 * the working directory. This makes the library usable in both CLI
 * contexts (process.cwd()) and IDE contexts (workspace folder).
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';
import type { RepoInfo, GitOptions } from './types.js';
import { GitError } from './types.js';
import { parseGitHubUrl } from './url-parser.js';

export { GitError };

/**
 * Sanitize a string for safe use in file paths and git commands.
 * Removes or replaces potentially dangerous characters.
 */
function sanitizeForPath(input: string): string {
    return String(input)
        .replace(/\.\./g, '_')           // Prevent path traversal
        .replace(/[;&|`$(){}[\]<>!]/g, '') // Remove shell metacharacters
        .replace(/\s+/g, '-')            // Replace whitespace with dashes
        .replace(/[^a-zA-Z0-9_\-./]/g, '_'); // Replace other special chars
}

/**
 * Validate that a string is safe for use as a branch name in shell commands.
 * Git branch names have their own restrictions, and we add additional safety checks.
 * Throws an error if the branch name is invalid or potentially dangerous.
 */
function validateBranchName(branch: string): void {
    // Check for empty
    if (!branch || branch.trim().length === 0) {
        throw new Error('Branch name cannot be empty');
    }

    // Check for shell metacharacters that could cause command injection
    // Even in double quotes, $() and `` can execute commands
    const dangerousChars = /[`$\\!;|&<>(){}[\]'"]/;
    if (dangerousChars.test(branch)) {
        throw new Error(`Branch name contains invalid characters: ${branch}`);
    }

    // Git branch restrictions: no spaces, no control chars, no ~^:?*[
    const gitInvalidChars = /[\s~^:?*\[\\]/;
    if (gitInvalidChars.test(branch)) {
        throw new Error(`Branch name contains invalid git characters: ${branch}`);
    }

    // No .. sequences
    if (branch.includes('..')) {
        throw new Error(`Branch name cannot contain '..': ${branch}`);
    }

    // Cannot start or end with / or .
    if (/^[./]|[./]$/.test(branch)) {
        throw new Error(`Branch name cannot start or end with '/' or '.': ${branch}`);
    }
}

const execAsync = promisify(exec);

/**
 * Error type from child_process.exec with additional properties
 */
interface ExecError extends Error {
    code?: number;
    stderr?: string;
    stdout?: string;
}

/**
 * Execute a git command in the specified directory.
 * Throws GitError with full context on failure.
 */
async function execGit(
    command: string,
    options: GitOptions = {}
): Promise<{ stdout: string; stderr: string }> {
    const cwd = options.cwd || process.cwd();
    try {
        return await execAsync(command, { cwd });
    } catch (error) {
        const execError = error as ExecError;
        throw new GitError({
            message: execError.message || 'Git command failed',
            command,
            stderr: execError.stderr || '',
            exitCode: execError.code ?? null,
            cwd,
        });
    }
}

/**
 * Detect the GitHub repository from the current directory's git remote.
 * @returns Repository info, or null if the remote URL is not a GitHub URL
 * @throws {GitError} If the git command fails (e.g., not a git repo, no origin remote)
 */
export async function detectRepository(options: GitOptions = {}): Promise<RepoInfo | null> {
    const { stdout } = await execGit('git remote get-url origin', options);
    const url = stdout.trim();
    return parseGitHubUrl(url);
}

/**
 * Get the current git branch.
 * Returns null if in detached HEAD state.
 * @throws {GitError} If the git command fails (e.g., not a git repo)
 */
export async function getCurrentBranch(options: GitOptions = {}): Promise<string | null> {
    const { stdout } = await execGit('git branch --show-current', options);
    return stdout.trim() || null;
}

/**
 * Check if there are uncommitted changes.
 * @throws {GitError} If the git command fails (e.g., not a git repo)
 */
export async function hasUncommittedChanges(options: GitOptions = {}): Promise<boolean> {
    const { stdout } = await execGit('git status --porcelain', options);
    return stdout.trim().length > 0;
}

/**
 * Check if a branch exists locally.
 * Returns false if branch doesn't exist; throws on other git errors.
 * @throws {GitError} If the git command fails for reasons other than branch not existing
 */
export async function branchExists(
    branchName: string,
    options: GitOptions = {}
): Promise<boolean> {
    try {
        await execGit(`git show-ref --verify --quiet refs/heads/${branchName}`, options);
        return true;
    } catch (error) {
        // Exit code 1 means branch doesn't exist (expected)
        // Other errors should propagate
        if (error instanceof GitError && error.exitCode === 1) {
            return false;
        }
        throw error;
    }
}

/**
 * Create and checkout a new branch.
 * @throws {GitError} If the branch cannot be created (e.g., already exists, invalid name)
 */
export async function createBranch(
    branchName: string,
    options: GitOptions = {}
): Promise<void> {
    await execGit(`git checkout -b "${branchName}"`, options);
}

/**
 * Checkout an existing branch.
 * @throws {GitError} If the branch cannot be checked out (e.g., doesn't exist, uncommitted changes)
 */
export async function checkoutBranch(
    branchName: string,
    options: GitOptions = {}
): Promise<void> {
    await execGit(`git checkout "${branchName}"`, options);
}

/**
 * Pull latest from origin.
 * @throws {GitError} If the pull fails (e.g., merge conflicts, no remote, network issues)
 */
export async function pullLatest(options: GitOptions = {}): Promise<void> {
    await execGit('git pull', options);
}

/**
 * Fetch from origin.
 * @throws {GitError} If the fetch fails (e.g., no remote, network issues)
 */
export async function fetchOrigin(options: GitOptions = {}): Promise<void> {
    await execGit('git fetch origin', options);
}

/**
 * Get number of commits behind origin.
 * @throws {GitError} If the git command fails (e.g., no network, branch doesn't exist)
 */
export async function getCommitsBehind(
    branch: string,
    options: GitOptions = {}
): Promise<number> {
    await fetchOrigin(options);
    const { stdout } = await execGit(
        `git rev-list --count ${branch}..origin/${branch}`,
        options
    );
    return parseInt(stdout.trim(), 10) || 0;
}

/**
 * Get number of commits ahead of origin.
 * @throws {GitError} If the git command fails (e.g., no network, branch doesn't exist)
 */
export async function getCommitsAhead(
    branch: string,
    options: GitOptions = {}
): Promise<number> {
    await fetchOrigin(options);
    const { stdout } = await execGit(
        `git rev-list --count origin/${branch}..${branch}`,
        options
    );
    return parseInt(stdout.trim(), 10) || 0;
}

/**
 * Check if working directory is a git repository.
 * Returns false if not a git repo; throws on other git errors.
 * @throws {GitError} If the git command fails for reasons other than not being a repo
 */
export async function isGitRepository(options: GitOptions = {}): Promise<boolean> {
    try {
        await execGit('git rev-parse --git-dir', options);
        return true;
    } catch (error) {
        // Exit code 128 means not a git repository (expected)
        if (error instanceof GitError && error.exitCode === 128) {
            return false;
        }
        throw error;
    }
}

/**
 * Get the root directory of the git repository.
 * @throws {GitError} If the git command fails (e.g., not a git repo)
 */
export async function getRepositoryRoot(options: GitOptions = {}): Promise<string> {
    const { stdout } = await execGit('git rev-parse --show-toplevel', options);
    return stdout.trim();
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
 * Extract issue number from a branch name.
 * Supports common patterns:
 * - user/123-feature-name
 * - feature/123-something
 * - 123-fix-bug
 * - fix-123-something
 * - ends with #123 or /123
 */
export function extractIssueNumberFromBranch(branchName: string): number | null {
    const patterns = [
        /\/(\d+)-/,      // user/123-title
        /^(\d+)-/,       // 123-title
        /-(\d+)-/,       // feature-123-title
        /[/#](\d+)$/,    // ends with #123 or /123
    ];

    for (const pattern of patterns) {
        const match = branchName.match(pattern);
        if (match) {
            return parseInt(match[1], 10);
        }
    }

    return null;
}

/**
 * Get all local branches.
 * @throws {GitError} If the git command fails (e.g., not a git repo)
 */
export async function getLocalBranches(options: GitOptions = {}): Promise<string[]> {
    const { stdout } = await execGit('git branch --format="%(refname:short)"', options);
    return stdout
        .split('\n')
        .map(b => b.trim())
        .filter(b => b.length > 0);
}

/**
 * Get all remote branches (excluding HEAD), stripped of origin/ prefix.
 * @throws {GitError} If the git command fails (e.g., not a git repo, network issues)
 */
export async function getRemoteBranches(options: GitOptions = {}): Promise<string[]> {
    // Fetch to get latest remote branches
    await execGit('git fetch --prune', options);

    const { stdout } = await execGit('git branch -r --format="%(refname:short)"', options);
    return stdout
        .split('\n')
        .map(b => b.trim())
        .filter(b => b.length > 0 && !b.includes('HEAD'))
        .map(b => b.replace(/^origin\//, '')); // Strip origin/ prefix
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
 * Get the default branch name (main or master).
 * Tries remote HEAD first, falls back to checking local branches.
 * @throws {GitError} If all detection methods fail (e.g., not a git repo)
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
    } catch (error) {
        // Exit code 128 or 1 means symbolic ref doesn't exist - that's expected
        // for repos without origin or newly initialized repos
        if (!(error instanceof GitError) || (error.exitCode !== 128 && error.exitCode !== 1)) {
            throw error;
        }
        // Fall through to checking if main or master exists
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
 * Validate that a path is safe for use in shell commands.
 * Throws an error if the path contains dangerous characters.
 */
function validatePath(path: string): void {
    if (!path || path.trim().length === 0) {
        throw new Error('Path cannot be empty');
    }

    // Check for shell metacharacters that could cause command injection
    const dangerousChars = /[`$;|&<>(){}[\]'"\n\r]/;
    if (dangerousChars.test(path)) {
        throw new Error(`Path contains invalid characters: ${path}`);
    }
}

/**
 * Create a new worktree for a branch.
 * @param worktreePath - Path where the worktree will be created
 * @param branch - Branch to checkout in the worktree
 * @param options - Git options (cwd determines the source repository)
 * @throws {GitError} If the worktree cannot be created
 */
export async function createWorktree(
    worktreePath: string,
    branch: string,
    options: GitOptions = {}
): Promise<void> {
    // Validate inputs to prevent command injection
    validateBranchName(branch);
    validatePath(worktreePath);

    // Check if branch exists locally first
    const localExists = await branchExists(branch, options);

    if (localExists) {
        // Branch exists locally - create worktree from it
        await execGit(`git worktree add "${worktreePath}" "${branch}"`, options);
    } else {
        // Try to create from remote tracking branch
        try {
            await execGit(`git worktree add "${worktreePath}" -b "${branch}" "origin/${branch}"`, options);
        } catch (error) {
            // If remote branch doesn't exist (exit code 128), create a new branch from current HEAD
            // Other errors should propagate
            if (!(error instanceof GitError) || error.exitCode !== 128) {
                throw error;
            }
            await execGit(`git worktree add -b "${branch}" "${worktreePath}"`, options);
        }
    }
}

/**
 * Remove a worktree.
 * @param worktreePath - Path to the worktree to remove
 * @param options - Git options
 * @param force - Force removal even if worktree has uncommitted changes
 * @throws {GitError} If the worktree cannot be removed (e.g., uncommitted changes, invalid path)
 */
export async function removeWorktree(
    worktreePath: string,
    options: GitOptions = {},
    force: boolean = false
): Promise<void> {
    validatePath(worktreePath);
    const forceFlag = force ? '--force' : '';
    await execGit(`git worktree remove ${forceFlag} "${worktreePath}"`, options);
}

/**
 * List all worktrees for the repository.
 * @param options - Git options
 * @returns Array of worktree information
 * @throws {GitError} If the git command fails (e.g., not a git repo)
 */
export async function listWorktrees(options: GitOptions = {}): Promise<WorktreeInfo[]> {
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
 * Generate a worktree path based on repo and issue info
 * @param basePath - Base directory for worktrees (e.g., ~/.ghp/worktrees)
 * @param repoName - Repository name
 * @param identifier - Issue number or branch name to use as identifier
 * @param title - Optional title to create a descriptive directory name (e.g., "123-fix-auth-bug")
 * @returns Full path to the worktree directory
 */
export function generateWorktreePath(
    basePath: string,
    repoName: string,
    identifier: string | number,
    title?: string
): string {
    // Sanitize inputs to prevent path traversal and command injection
    const safeRepoName = sanitizeForPath(repoName);

    // Generate directory name: if title provided, use "{number}-{title-slug}" format
    let dirName: string;
    if (title && typeof identifier === 'number') {
        // Create a slug from the title (max 35 chars for the slug portion)
        const titleSlug = sanitizeForBranchName(title).substring(0, 35).replace(/-$/, '');
        dirName = `${identifier}-${titleSlug}`;
    } else {
        dirName = sanitizeForPath(String(identifier));
    }

    // Expand ~ to home directory using os.homedir() for cross-platform support
    const expandedBase = basePath.startsWith('~')
        ? basePath.replace('~', homedir())
        : basePath;

    // Join path segments, handling trailing slashes
    const cleanBase = expandedBase.replace(/\/+$/, '');
    return `${cleanBase}/${safeRepoName}/${dirName}`;
}

/**
 * Git utilities re-exported from core library.
 *
 * For CLI usage, all functions use process.cwd() by default.
 * The core library accepts an optional { cwd } parameter for IDE integrations.
 */

import { listWorktrees as _listWorktrees } from '@bretwardjames/ghp-core';

// Re-export all git utilities from core
// These all use process.cwd() by default, which is correct for CLI usage
export {
    detectRepository,
    getCurrentBranch,
    hasUncommittedChanges,
    branchExists,
    createBranch,
    createBranchNoCheckout,
    checkoutBranch,
    pullLatest,
    fetchOrigin,
    getCommitsBehind,
    getCommitsAhead,
    isGitRepository,
    getRepositoryRoot,
    sanitizeForBranchName,
    generateBranchName,
    getDefaultBranch,
    getLocalBranches,
    getRemoteBranches,
    getAllBranches,
    listTags,
    resolveRef,
    parseGitHubUrl,
    // Worktree operations
    createWorktree,
    removeWorktree,
    listWorktrees,
    getWorktreeForBranch,
    worktreeExists,
    generateWorktreePath,
    // Error class for handling git failures
    GitError,
} from '@bretwardjames/ghp-core';

// Re-export the RepoInfo and WorktreeInfo types
export type { RepoInfo, GitOptions, WorktreeInfo } from '@bretwardjames/ghp-core';

/**
 * Return the path of the main (non-linked) worktree.
 *
 * Unlike `getRepositoryRoot()`, which resolves relative to process.cwd() and
 * therefore returns the linked worktree's root when called from inside one,
 * this function always returns the primary worktree path by reading
 * `git worktree list --porcelain` and finding the entry marked as `isMain`.
 */
export async function getMainWorktreeRoot(): Promise<string | null> {
    try {
        const worktrees = await _listWorktrees();
        const main = worktrees.find(wt => wt.isMain);
        return main?.path ?? null;
    } catch {
        return null;
    }
}

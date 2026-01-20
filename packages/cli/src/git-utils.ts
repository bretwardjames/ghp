/**
 * Git utilities re-exported from core library.
 *
 * For CLI usage, all functions use process.cwd() by default.
 * The core library accepts an optional { cwd } parameter for IDE integrations.
 */

// Re-export all git utilities from core
// These all use process.cwd() by default, which is correct for CLI usage
export {
    detectRepository,
    getCurrentBranch,
    hasUncommittedChanges,
    branchExists,
    createBranch,
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
    parseGitHubUrl,
    // Worktree operations
    createWorktree,
    removeWorktree,
    listWorktrees,
    getWorktreeForBranch,
    worktreeExists,
    generateWorktreePath,
} from '@bretwardjames/ghp-core';

// Re-export the RepoInfo and WorktreeInfo types
export type { RepoInfo, GitOptions, WorktreeInfo } from '@bretwardjames/ghp-core';

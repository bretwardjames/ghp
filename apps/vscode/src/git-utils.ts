/**
 * Git utilities for VSCode extension.
 *
 * Wraps @bretwardjames/ghp-core git functions with VSCode workspace path.
 */

import * as vscode from 'vscode';
import {
    getCurrentBranch as coreGetCurrentBranch,
    hasUncommittedChanges as coreHasUncommittedChanges,
    fetchOrigin as coreFetchOrigin,
    getCommitsBehind as coreGetCommitsBehind,
    checkoutBranch as coreCheckoutBranch,
    pullLatest as corePullLatest,
    createBranch as coreCreateBranch,
    branchExists as coreBranchExists,
    sanitizeForBranchName,
    generateBranchName as coreGenerateBranchName,
    removeWorktree as coreRemoveWorktree,
} from '@bretwardjames/ghp-core';

// Re-export pure functions that don't need cwd
export { sanitizeForBranchName } from '@bretwardjames/ghp-core';

export interface GitStatus {
    currentBranch: string;
    isOnMainBranch: boolean;
    isBehindOrigin: boolean;
    behindCount: number;
    hasUncommittedChanges: boolean;
}

/**
 * Get the workspace path for git operations
 */
function getWorkspacePath(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return null;
    }
    return folders[0].uri.fsPath;
}

/**
 * Get git options with VSCode workspace cwd
 */
function getGitOptions(): { cwd: string } {
    const cwd = getWorkspacePath();
    if (!cwd) {
        throw new Error('No workspace folder open');
    }
    return { cwd };
}

/**
 * Get the current branch name
 */
export async function getCurrentBranch(): Promise<string> {
    const branch = await coreGetCurrentBranch(getGitOptions());
    return branch || 'HEAD';
}

/**
 * Check if there are uncommitted changes
 */
export async function hasUncommittedChanges(): Promise<boolean> {
    return coreHasUncommittedChanges(getGitOptions());
}

/**
 * Fetch from origin to get latest refs
 */
export async function fetchOrigin(): Promise<void> {
    return coreFetchOrigin(getGitOptions());
}

/**
 * Check how many commits the local branch is behind origin
 */
export async function getCommitsBehind(branch: string): Promise<number> {
    return coreGetCommitsBehind(branch, getGitOptions());
}

/**
 * Get comprehensive git status for the Start Working workflow
 */
export async function getGitStatus(mainBranch: string): Promise<GitStatus> {
    const currentBranch = await getCurrentBranch();
    const isOnMainBranch = currentBranch === mainBranch;

    // Fetch to ensure we have latest refs
    try {
        await fetchOrigin();
    } catch (e) {
        console.warn('Could not fetch from origin:', e);
    }

    const behindCount = isOnMainBranch ? await getCommitsBehind(mainBranch) : 0;
    const uncommittedChanges = await hasUncommittedChanges();

    return {
        currentBranch,
        isOnMainBranch,
        isBehindOrigin: behindCount > 0,
        behindCount,
        hasUncommittedChanges: uncommittedChanges,
    };
}

/**
 * Checkout a branch
 */
export async function checkoutBranch(branch: string): Promise<void> {
    return coreCheckoutBranch(branch, getGitOptions());
}

/**
 * Pull latest from origin
 */
export async function pullLatest(): Promise<void> {
    return corePullLatest(getGitOptions());
}

/**
 * Create and checkout a new branch
 */
export async function createBranch(branchName: string): Promise<void> {
    return coreCreateBranch(branchName, getGitOptions());
}

/**
 * Check if a branch already exists locally or remotely
 */
export async function branchExists(branchName: string): Promise<boolean> {
    return coreBranchExists(branchName, getGitOptions());
}

/**
 * Generate a branch name from a pattern and item details
 */
export function generateBranchName(
    pattern: string,
    variables: {
        user: string;
        number: number | null;
        title: string;
        repo: string | null;
    },
    maxLength: number
): string {
    return coreGenerateBranchName(
        pattern,
        {
            user: variables.user,
            number: variables.number,
            title: variables.title,
            repo: variables.repo || '',
        },
        maxLength
    );
}

/**
 * Remove a worktree
 */
export async function removeWorktree(worktreePath: string, force: boolean = false): Promise<void> {
    return coreRemoveWorktree(worktreePath, getGitOptions(), force);
}

/**
 * Worktree Workflows
 *
 * Centralized worktree operations with hook firing.
 * Used by CLI, MCP, VS Code extension, and nvim plugin.
 *
 * IMPORTANT: Hooks are fired from INSIDE the worktree directory so that
 * plugins (like Ragtime) create files in the correct location.
 */

import {
    createWorktree as gitCreateWorktree,
    removeWorktree as gitRemoveWorktree,
    listWorktrees,
    GitError,
} from '../git-utils.js';
import { executeHooksForEvent, hasHooksForEvent } from '../plugins/executor.js';
import type {
    WorktreeCreatedPayload,
    WorktreeRemovedPayload,
    HookResult,
} from '../plugins/types.js';
import type {
    CreateWorktreeOptions,
    CreateWorktreeResult,
    RemoveWorktreeOptions,
    RemoveWorktreeResult,
} from './types.js';

// =============================================================================
// Create Worktree Workflow
// =============================================================================

/**
 * Create a worktree and fire the worktree-created hook.
 *
 * This workflow:
 * 1. Checks if worktree already exists
 * 2. Creates the worktree with the specified branch
 * 3. Fires the worktree-created hook FROM INSIDE the worktree
 *
 * @example
 * ```typescript
 * const result = await createWorktreeWorkflow({
 *   repo: { owner: 'user', name: 'repo', fullName: 'user/repo' },
 *   issueNumber: 123,
 *   issueTitle: 'Add new feature',
 *   branch: 'user/123-add-new-feature',
 * });
 *
 * if (result.success) {
 *   console.log(`Worktree created at ${result.worktree.path}`);
 * }
 * ```
 */
export async function createWorktreeWorkflow(
    options: CreateWorktreeOptions
): Promise<CreateWorktreeResult> {
    const { repo, issueNumber, issueTitle, branch, path } = options;
    const hookResults: HookResult[] = [];

    try {
        // Check if worktree already exists for this branch
        const existingWorktrees = await listWorktrees();
        const existing = existingWorktrees.find(wt => wt.branch === branch && !wt.isMain);

        if (existing) {
            return {
                success: true,
                worktree: {
                    path: existing.path,
                    name: existing.path.split('/').pop() || '',
                },
                alreadyExisted: true,
                branch,
                hookResults: [], // No hooks fired for existing worktrees
            };
        }

        const worktreePath = path;
        const worktreeName = worktreePath.split('/').pop() || '';

        // Create the worktree
        await gitCreateWorktree(worktreePath, branch, {});

        // Fire worktree-created hook
        if (hasHooksForEvent('worktree-created')) {
            const payload: WorktreeCreatedPayload = {
                repo: `${repo.owner}/${repo.name}`,
                branch,
                worktree: {
                    path: worktreePath,
                    name: worktreeName,
                },
            };

            // Add issue info if available
            if (issueNumber) {
                payload.issue = {
                    number: issueNumber,
                    title: issueTitle || '',
                    url: `https://github.com/${repo.owner}/${repo.name}/issues/${issueNumber}`,
                };
            }

            // Fire hook from inside the worktree so plugins create files there
            const results = await executeHooksForEvent('worktree-created', payload, {
                cwd: worktreePath,
            });
            hookResults.push(...results);
        }

        return {
            success: true,
            worktree: {
                path: worktreePath,
                name: worktreeName,
            },
            alreadyExisted: false,
            branch,
            hookResults,
        };
    } catch (error) {
        // Include stderr from GitError for better diagnostics
        const errorMessage = error instanceof GitError && error.stderr
            ? `${error.message}\n${error.stderr}`
            : error instanceof Error ? error.message : String(error);
        return {
            success: false,
            error: errorMessage,
            hookResults,
        };
    }
}

// =============================================================================
// Remove Worktree Workflow
// =============================================================================

/**
 * Remove a worktree and fire the worktree-removed hook.
 *
 * This workflow:
 * 1. Finds the worktree for the issue (if path not provided)
 * 2. Removes the worktree
 * 3. Fires the worktree-removed hook
 *
 * @example
 * ```typescript
 * const result = await removeWorktreeWorkflow({
 *   repo: { owner: 'user', name: 'repo', fullName: 'user/repo' },
 *   issueNumber: 123,
 *   branch: 'user/123-add-feature',
 * });
 *
 * if (result.success) {
 *   console.log(`Worktree removed: ${result.worktree.path}`);
 * }
 * ```
 */
export async function removeWorktreeWorkflow(
    options: RemoveWorktreeOptions
): Promise<RemoveWorktreeResult> {
    const { repo, issueNumber, issueTitle, branch, worktreePath, force } = options;
    const hookResults: HookResult[] = [];

    try {
        // Find the worktree if path not provided
        let targetPath = worktreePath;
        let targetBranch = branch;

        if (!targetPath) {
            const worktrees = await listWorktrees();

            // Find by branch if provided
            if (targetBranch) {
                const wt = worktrees.find(w => w.branch === targetBranch && !w.isMain);
                if (wt) {
                    targetPath = wt.path;
                }
            }

            // If still not found, search by issue number in branch name
            if (!targetPath) {
                const wt = worktrees.find(w => {
                    if (!w.branch || w.isMain) return false;
                    // Match common patterns: user/123-title, 123-title, issue-123
                    return w.branch.includes(`/${issueNumber}-`) ||
                           w.branch.includes(`/${issueNumber}_`) ||
                           w.branch.startsWith(`${issueNumber}-`) ||
                           w.branch.includes(`issue-${issueNumber}`);
                });
                if (wt) {
                    targetPath = wt.path;
                    targetBranch = wt.branch || undefined;
                }
            }
        }

        if (!targetPath) {
            return {
                success: false,
                error: `No worktree found for issue #${issueNumber}`,
                hookResults,
            };
        }

        const worktreeName = targetPath.split('/').pop() || '';

        // Remove the worktree
        await gitRemoveWorktree(targetPath, {}, force);

        // Fire worktree-removed hook
        if (hasHooksForEvent('worktree-removed')) {
            const payload: WorktreeRemovedPayload = {
                repo: `${repo.owner}/${repo.name}`,
                branch: targetBranch || '',
                worktree: {
                    path: targetPath,
                    name: worktreeName,
                },
            };

            // Add issue info if available
            if (issueNumber) {
                payload.issue = {
                    number: issueNumber,
                    title: issueTitle || '',
                    url: `https://github.com/${repo.owner}/${repo.name}/issues/${issueNumber}`,
                };
            }

            const results = await executeHooksForEvent('worktree-removed', payload);
            hookResults.push(...results);
        }

        return {
            success: true,
            worktree: {
                path: targetPath,
                name: worktreeName,
            },
            branch: targetBranch,
            hookResults,
        };
    } catch (error) {
        // Include stderr from GitError for better diagnostics
        const errorMessage = error instanceof GitError && error.stderr
            ? `${error.message}\n${error.stderr}`
            : error instanceof Error ? error.message : String(error);
        return {
            success: false,
            error: errorMessage,
            hookResults,
        };
    }
}

/**
 * Issue Workflows
 *
 * Centralized issue operations with hook firing.
 * Used by CLI, MCP, VS Code extension, and nvim plugin.
 */

import { GitHubAPI } from '../github-api.js';
import {
    createBranch,
    checkoutBranch,
    branchExists,
    generateBranchName,
    getCurrentBranch,
} from '../git-utils.js';
import { executeHooksForEvent, hasHooksForEvent } from '../plugins/executor.js';
import type {
    IssueCreatedPayload,
    IssueStartedPayload,
    HookResult,
    OnFailureBehavior,
} from '../plugins/types.js';
import type { RepoInfo } from '../types.js';
import type {
    CreateIssueOptions,
    CreateIssueResult,
    StartIssueOptions,
    StartIssueResult,
    IssueInfo,
} from './types.js';
import { createWorktreeWorkflow } from './worktree.js';

// =============================================================================
// Create Issue Workflow
// =============================================================================

/**
 * Create an issue, add it to a project, and fire the issue-created hook.
 *
 * This workflow:
 * 1. Creates the issue in GitHub
 * 2. Adds it to the specified project
 * 3. Sets initial status (if provided)
 * 4. Applies labels (if provided)
 * 5. Links to parent issue (if provided)
 * 6. Fires the issue-created hook
 *
 * @example
 * ```typescript
 * const result = await createIssueWorkflow(api, {
 *   repo: { owner: 'user', name: 'repo', fullName: 'user/repo' },
 *   title: 'Add new feature',
 *   body: 'Description of the feature',
 *   projectId: 'PVT_xxx',
 *   status: 'Todo',
 *   labels: ['enhancement'],
 * });
 *
 * if (result.success) {
 *   console.log(`Created issue #${result.issue.number}`);
 * }
 * ```
 */
export async function createIssueWorkflow(
    api: GitHubAPI,
    options: CreateIssueOptions
): Promise<CreateIssueResult> {
    const {
        repo,
        title,
        body = '',
        projectId,
        status,
        labels = [],
        assignees = [],
        parentIssueNumber,
        onFailure,
    } = options;

    const hookResults: HookResult[] = [];

    try {
        // 1. Create the issue
        const issue = await api.createIssue(repo, title, body);
        if (!issue) {
            return {
                success: false,
                error: 'Failed to create issue',
                hookResults,
            };
        }

        const issueInfo: IssueInfo = {
            number: issue.number,
            title,
            body,
            url: `https://github.com/${repo.owner}/${repo.name}/issues/${issue.number}`,
        };

        // 2. Add to project
        const itemId = await api.addToProject(projectId, issue.id);
        if (!itemId) {
            // Issue created but failed to add to project
            // Still return success since the issue exists
            return {
                success: true,
                issue: issueInfo,
                error: 'Issue created but failed to add to project',
                hookResults,
            };
        }

        // 3. Set initial status
        if (status) {
            const statusField = await api.getStatusField(projectId);
            if (statusField) {
                const option = statusField.options.find(
                    o => o.name.toLowerCase() === status.toLowerCase()
                );
                if (option) {
                    await api.updateItemStatus(projectId, itemId, statusField.fieldId, option.id);
                }
            }
        }

        // 4. Apply labels
        for (const label of labels) {
            await api.addLabelToIssue(repo, issue.number, label);
        }

        // 5. Set assignees
        if (assignees.length > 0) {
            await api.updateAssignees(repo, issue.number, assignees);
        }

        // 6. Link to parent issue
        if (parentIssueNumber) {
            await api.addSubIssue(repo, parentIssueNumber, issue.number);
        }

        // 7. Fire issue-created hook
        if (hasHooksForEvent('issue-created')) {
            const payload: IssueCreatedPayload = {
                repo: `${repo.owner}/${repo.name}`,
                issue: {
                    number: issue.number,
                    title,
                    body,
                    url: issueInfo.url,
                },
            };

            const results = await executeHooksForEvent('issue-created', payload, { onFailure });
            hookResults.push(...results);
        }

        return {
            success: true,
            issue: issueInfo,
            projectItemId: itemId,
            hookResults,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            hookResults,
        };
    }
}

// =============================================================================
// Start Issue Workflow
// =============================================================================

/**
 * Start working on an issue: create/checkout branch, optionally create worktree,
 * and fire the issue-started hook.
 *
 * This workflow handles the core "start working" logic:
 * 1. Creates a new branch (if no linked branch exists)
 * 2. Checks out the branch (or creates a worktree in parallel mode)
 * 3. Updates issue status (if not in review mode)
 * 4. Fires the issue-started hook (if not in review mode)
 * 5. Fires the worktree-created hook (if worktree was created)
 *
 * Note: This workflow does NOT handle interactive prompts or UI.
 * The calling code (CLI, MCP, etc.) should handle user interaction
 * and pass the resolved options to this workflow.
 *
 * @example
 * ```typescript
 * const result = await startIssueWorkflow(api, {
 *   repo: { owner: 'user', name: 'repo', fullName: 'user/repo' },
 *   issueNumber: 123,
 *   issueTitle: 'Add new feature',
 *   branchPattern: '{user}/{number}-{title}',
 *   username: 'developer',
 *   parallel: true,
 * });
 *
 * if (result.success) {
 *   console.log(`Working on branch ${result.branch}`);
 *   if (result.worktree) {
 *     console.log(`Worktree at ${result.worktree.path}`);
 *   }
 * }
 * ```
 */
export async function startIssueWorkflow(
    api: GitHubAPI,
    options: StartIssueOptions
): Promise<StartIssueResult> {
    const {
        repo,
        issueNumber,
        issueTitle = '',
        linkedBranch,
        parallel = false,
        worktreePath,
        review = false,
        branchPattern = '{user}/{number}-{title}',
        username = 'user',
        targetStatus,
        projectId,
        statusFieldId,
        statusOptionId,
        onFailure,
    } = options;

    const hookResults: HookResult[] = [];
    let branch = linkedBranch;
    let branchCreated = false;
    let worktreeCreated = false;
    let worktreeInfo: { path: string; name: string } | undefined;

    try {
        // 1. Create branch if no linked branch exists
        if (!branch) {
            branch = generateBranchName(branchPattern, {
                user: username,
                number: issueNumber,
                title: issueTitle,
                repo: repo.name,
            });

            // Check if branch already exists
            if (!(await branchExists(branch))) {
                await createBranch(branch);
                branchCreated = true;
            }
        }

        // 2. Either create worktree (parallel mode) or checkout branch
        if (parallel) {
            if (!worktreePath) {
                return {
                    success: false,
                    error: 'worktreePath is required when parallel mode is enabled',
                    hookResults,
                };
            }

            const worktreeResult = await createWorktreeWorkflow({
                repo,
                issueNumber,
                issueTitle,
                branch,
                path: worktreePath,
                onFailure,
            });

            if (!worktreeResult.success) {
                return {
                    success: false,
                    error: worktreeResult.error,
                    hookResults,
                };
            }

            worktreeInfo = worktreeResult.worktree;
            worktreeCreated = !worktreeResult.alreadyExisted;

            // Add worktree hook results
            hookResults.push(...worktreeResult.hookResults);
        } else {
            // Checkout the branch
            await checkoutBranch(branch);
        }

        // 3. Update issue status (if not review mode and status info provided)
        if (!review && projectId && statusFieldId && statusOptionId) {
            // Get the project item ID for this issue
            const item = await api.findItemByNumber(repo, issueNumber);
            if (item) {
                await api.updateItemStatus(projectId, item.id, statusFieldId, statusOptionId);
            }
        }

        // 4. Fire issue-started hook (if not review mode)
        // If worktree was created, fire from inside the worktree so plugins create files there
        if (!review && hasHooksForEvent('issue-started')) {
            const payload: IssueStartedPayload = {
                repo: `${repo.owner}/${repo.name}`,
                issue: {
                    number: issueNumber,
                    title: issueTitle,
                    body: '', // Body not typically available at this point
                    url: `https://github.com/${repo.owner}/${repo.name}/issues/${issueNumber}`,
                },
                branch,
            };

            // Fire hook from inside the worktree if one was created
            const hookCwd = worktreeInfo?.path;
            const results = await executeHooksForEvent('issue-started', payload, {
                cwd: hookCwd,
                onFailure,
            });
            hookResults.push(...results);
        }

        return {
            success: true,
            branch,
            branchCreated,
            worktree: worktreeInfo,
            worktreeCreated,
            issue: {
                number: issueNumber,
                title: issueTitle,
                url: `https://github.com/${repo.owner}/${repo.name}/issues/${issueNumber}`,
            },
            hookResults,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            hookResults,
        };
    }
}

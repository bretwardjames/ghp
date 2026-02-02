import * as vscode from 'vscode';
import { GitHubAPI } from './github-api';
import {
    getGitStatus,
    checkoutBranch,
    pullLatest,
    createBranch,
    branchExists,
    generateBranchName,
    getCurrentBranch,
} from './git-utils';
import type { NormalizedProjectItem, ProjectWithViews } from './types';
import { getBranchLinker } from './extension';
import {
    executeHooksForEvent,
    hasHooksForEvent,
    type IssueStartedPayload,
    type HookResult,
} from '@bretwardjames/ghp-core';

export interface StartWorkingContext {
    item: NormalizedProjectItem;
    project: ProjectWithViews;
}

/**
 * Unified "Start Working" workflow.
 *
 * Decision flow:
 * 1. Issue has linked branch → Checkout that branch (if not already on it), update status/label
 * 2. Issue NOT linked + on main → Offer: Create new branch OR Link existing branch
 * 3. Issue NOT linked + NOT on main → Offer: Switch to main & create, Create from current, Link existing
 */
export async function executeStartWorking(
    api: GitHubAPI,
    context: StartWorkingContext
): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('ghProjects');
    const mainBranch = config.get<string>('mainBranch', 'main');
    const branchPattern = config.get<string>('branchNamePattern', '{user}/{number}-{title}');
    const targetStatus = config.get<string>('startWorkingStatus', 'In Progress');
    const maxLength = config.get<number>('maxBranchNameLength', 60);

    const { item, project } = context;
    const branchLinker = getBranchLinker();

    // ═══════════════════════════════════════════════════════════════════════════
    // Step 0: Check if current user is assigned
    // ═══════════════════════════════════════════════════════════════════════════
    const isAssigned = item.assignees.some(
        (a) => a.login.toLowerCase() === api.username?.toLowerCase()
    );

    if (!isAssigned && item.number && item.repository) {
        const assignmentAction = await vscode.window.showQuickPick(
            ['Reassign to me', 'Add me', 'Leave as is'],
            {
                title: 'You are not assigned to this issue',
                placeHolder: 'What would you like to do?',
            }
        );

        if (!assignmentAction) {
            return false; // Cancelled
        }

        if (assignmentAction !== 'Leave as is') {
            const [owner, repo] = item.repository.split('/');
            if (owner && repo) {
                const newAssignees =
                    assignmentAction === 'Reassign to me'
                        ? [api.username!]
                        : [...item.assignees.map((a) => a.login), api.username!];

                const success = await api.updateAssignees(
                    owner,
                    repo,
                    item.number,
                    newAssignees,
                    item.type === 'pr' ? 'pr' : 'issue'
                );

                if (success) {
                    vscode.window.showInformationMessage(
                        assignmentAction === 'Reassign to me'
                            ? `Reassigned to ${api.username}`
                            : `Added ${api.username} as assignee`
                    );
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Step 1: Check if issue has a linked branch
    // ═══════════════════════════════════════════════════════════════════════════
    const linkedBranch = item.number ? await branchLinker.getBranchForIssue(item.number) : null;

    if (linkedBranch) {
        // Issue already has a linked branch - switch to it if needed
        const status = await getGitStatus(mainBranch);

        if (status.currentBranch === linkedBranch) {
            vscode.window.showInformationMessage(`Already on branch: ${linkedBranch}`);
        } else {
            const result = await branchLinker.switchToBranch(linkedBranch);
            if (!result.success) {
                vscode.window.showErrorMessage(result.error || 'Failed to switch branch');
                return false;
            }
            vscode.window.showInformationMessage(`Switched to branch: ${linkedBranch}`);
        }
    } else {
        // ═══════════════════════════════════════════════════════════════════════
        // Step 2: No linked branch - offer options based on current state
        // ═══════════════════════════════════════════════════════════════════════
        const status = await getGitStatus(mainBranch);
        const isOnMain = status.isOnMainBranch;

        // Build options based on current state
        let options: string[];
        if (isOnMain) {
            options = ['Create new branch', 'Link existing branch'];
        } else {
            options = [
                `Switch to ${mainBranch} & create branch`,
                `Create from current (${status.currentBranch})`,
                'Link existing branch',
            ];
        }

        const action = await vscode.window.showQuickPick(options, {
            title: 'No branch linked to this issue',
            placeHolder: 'Choose an action',
        });

        if (!action) {
            return false; // Cancelled
        }

        if (action === 'Link existing branch') {
            // Show branch picker with branches sorted by relevance to the issue
            const branches = await branchLinker.getAllBranches();
            const nonMainBranches = branches.filter(b => b !== mainBranch);

            if (nonMainBranches.length === 0) {
                vscode.window.showWarningMessage('No other branches available to link.');
                return false;
            }

            // Sort branches by relevance to the issue
            const sortedBranches = sortBranchesByRelevance(nonMainBranches, item);

            const selected = await vscode.window.showQuickPick(sortedBranches, {
                title: 'Select branch to link',
                placeHolder: 'Choose a branch (sorted by relevance)',
            });

            if (!selected) {
                return false; // Cancelled
            }

            // Link the branch
            if (item.number) {
                await branchLinker.linkBranch(selected, item.number);
                vscode.window.showInformationMessage(`Linked "${selected}" to #${item.number}`);
            }

            // Switch to the branch if not already on it
            if (status.currentBranch !== selected) {
                const switchResult = await branchLinker.switchToBranch(selected);
                if (!switchResult.success) {
                    vscode.window.showErrorMessage(switchResult.error || 'Failed to switch branch');
                    return false;
                }
            }
        } else if (action.includes('Create from current') || action === 'Create new branch') {
            // Create branch from current position
            const createResult = await createBranchAndLink(
                api,
                item,
                branchPattern,
                maxLength,
                branchLinker
            );
            if (!createResult) {
                return false;
            }
        } else {
            // Switch to main & create
            const switchResult = await branchLinker.switchToBranch(mainBranch);
            if (!switchResult.success) {
                vscode.window.showErrorMessage(switchResult.error || `Failed to switch to ${mainBranch}`);
                return false;
            }

            // Offer to pull if behind
            const newStatus = await getGitStatus(mainBranch);
            if (newStatus.isBehindOrigin) {
                const shouldPull = await handleBehindOrigin(mainBranch, newStatus.behindCount);
                if (!shouldPull) {
                    return false;
                }
            }

            // Create branch
            const createResult = await createBranchAndLink(
                api,
                item,
                branchPattern,
                maxLength,
                branchLinker
            );
            if (!createResult) {
                return false;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Step 3: Update project item status if configured
    // ═══════════════════════════════════════════════════════════════════════════
    if (targetStatus) {
        await updateItemStatus(api, project, item, targetStatus);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Step 4: Apply active label to track current work
    // ═══════════════════════════════════════════════════════════════════════════
    await applyActiveLabel(api, item);

    // ═══════════════════════════════════════════════════════════════════════════
    // Step 5: Fire issue-started hook
    // ═══════════════════════════════════════════════════════════════════════════
    if (item.number && item.repository && hasHooksForEvent('issue-started')) {
        const currentBranchName = await getCurrentBranch();
        if (currentBranchName) {
            const payload: IssueStartedPayload = {
                repo: item.repository,
                issue: {
                    number: item.number,
                    title: item.title,
                    body: '',
                    url: item.url || `https://github.com/${item.repository}/issues/${item.number}`,
                },
                branch: currentBranchName,
            };

            try {
                const results = await executeHooksForEvent('issue-started', payload);
                logHookResults(results);
            } catch (error) {
                // Non-fatal - just log it
                console.warn('Failed to execute issue-started hooks:', error);
            }
        }
    }

    return true;
}

/**
 * Create a new branch and link it to the issue.
 */
async function createBranchAndLink(
    api: GitHubAPI,
    item: NormalizedProjectItem,
    branchPattern: string,
    maxLength: number,
    branchLinker: ReturnType<typeof getBranchLinker>
): Promise<boolean> {
    const branchName = generateBranchName(
        branchPattern,
        {
            user: api.username || 'user',
            number: item.number,
            title: item.title,
            repo: item.repository,
        },
        maxLength
    );

    // Check if branch already exists
    if (await branchExists(branchName)) {
        const action = await vscode.window.showWarningMessage(
            `Branch "${branchName}" already exists.`,
            'Checkout existing branch',
            'Cancel'
        );

        if (action === 'Checkout existing branch') {
            try {
                await checkoutBranch(branchName);
                // Auto-link the branch to this issue
                await linkBranchToIssue(branchName, item, branchLinker);
                vscode.window.showInformationMessage(`Switched to branch: ${branchName}`);
                return true;
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to checkout branch: ${error}`);
                return false;
            }
        }
        return false;
    }

    // Create the new branch
    try {
        await createBranch(branchName);
        // Auto-link the branch to this issue
        await linkBranchToIssue(branchName, item, branchLinker);
        vscode.window.showInformationMessage(`Created and switched to branch: ${branchName}`);
        return true;
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create branch: ${error}`);
        return false;
    }
}

/**
 * Handle the case where main branch is behind origin
 */
async function handleBehindOrigin(
    mainBranch: string,
    behindCount: number
): Promise<boolean> {
    const action = await vscode.window.showWarningMessage(
        `Your ${mainBranch} branch is ${behindCount} commit${behindCount > 1 ? 's' : ''} behind origin.`,
        'Pull latest',
        'Continue anyway',
        'Cancel'
    );

    if (action === 'Cancel' || !action) {
        return false;
    }

    if (action === 'Pull latest') {
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Pulling latest changes...',
                },
                async () => {
                    await pullLatest();
                }
            );
            vscode.window.showInformationMessage(`Pulled latest changes from origin/${mainBranch}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to pull: ${error}`);
            return false;
        }
    }

    return true;
}

/**
 * Update the project item's status
 */
async function updateItemStatus(
    api: GitHubAPI,
    project: ProjectWithViews,
    item: NormalizedProjectItem,
    targetStatus: string
): Promise<void> {
    const statusInfo = api.findStatusFieldAndOption(project, targetStatus);

    if (!statusInfo) {
        // Status not found - maybe show a warning?
        const availableStatuses = project.fields.nodes
            .filter((f) => f.__typename === 'ProjectV2SingleSelectField')
            .flatMap((f) => f.options?.map((o) => o.name) || []);

        if (availableStatuses.length > 0) {
            vscode.window.showWarningMessage(
                `Status "${targetStatus}" not found in project. Available: ${availableStatuses.join(', ')}`
            );
        }
        return;
    }

    try {
        const success = await api.updateItemStatus(
            project.id,
            item.id,
            statusInfo.fieldId,
            statusInfo.optionId
        );

        if (success) {
            vscode.window.showInformationMessage(`Moved item to "${targetStatus}"`);
        }
    } catch (error) {
        vscode.window.showWarningMessage(`Failed to update status: ${error}`);
    }
}

/**
 * Link a branch to an issue using the BranchLinker
 */
async function linkBranchToIssue(
    branchName: string,
    item: NormalizedProjectItem,
    branchLinker: ReturnType<typeof getBranchLinker>
): Promise<void> {
    if (!item.number) {
        return; // Can't link without issue number
    }

    try {
        await branchLinker.linkBranch(branchName, item.number);
    } catch (error) {
        // Non-fatal - just log it
        console.warn('Failed to auto-link branch to issue:', error);
    }
}

/**
 * Sort branches by relevance to the issue.
 * Branches containing the issue number or title keywords are ranked higher.
 */
function sortBranchesByRelevance(branches: string[], item: NormalizedProjectItem): string[] {
    const issueNumber = item.number?.toString() || '';
    const titleWords = item.title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2); // Skip short words

    return [...branches].sort((a, b) => {
        const scoreA = getBranchRelevanceScore(a, issueNumber, titleWords);
        const scoreB = getBranchRelevanceScore(b, issueNumber, titleWords);
        return scoreB - scoreA; // Higher score first
    });
}

/**
 * Calculate a relevance score for a branch name.
 */
function getBranchRelevanceScore(branch: string, issueNumber: string, titleWords: string[]): number {
    const branchLower = branch.toLowerCase();
    let score = 0;

    // Strong match: issue number in branch name
    if (issueNumber && branch.includes(issueNumber)) {
        score += 100;
    }

    // Medium match: title words in branch name
    for (const word of titleWords) {
        if (branchLower.includes(word)) {
            score += 10;
        }
    }

    return score;
}

/**
 * Log hook execution results
 */
function logHookResults(results: HookResult[]): void {
    for (const result of results) {
        if (result.success) {
            console.log(`Hook "${result.hookName}" completed successfully`);
        } else {
            console.warn(`Hook "${result.hookName}" failed:`, result.error);
        }
    }
}

/**
 * Apply the active label to the current issue
 * This removes the label from any other issues first, ensuring only one is "active"
 */
async function applyActiveLabel(api: GitHubAPI, item: NormalizedProjectItem): Promise<void> {
    if (!item.number || !item.repository) {
        return; // Can't apply label without issue number and repository
    }

    const [owner, repo] = item.repository.split('/');
    if (!owner || !repo) {
        return;
    }

    try {
        const success = await api.transferActiveLabel(owner, repo, item.number);
        if (success) {
            const labelName = api.getActiveLabelName();
            console.log(`Applied ${labelName} label to #${item.number}`);
        }
    } catch (error) {
        // Non-fatal - just log it
        console.warn('Failed to apply active label:', error);
    }
}

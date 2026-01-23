import * as vscode from 'vscode';
import { GitHubAPI } from './github-api';
import { getCurrentBranch, extractIssueNumberFromBranch } from './git-utils';
import type { NormalizedProjectItem, ProjectWithViews } from './types';

/**
 * PR Workflow module - handles status transitions based on PR lifecycle
 */

// Re-export for backwards compatibility
export const extractIssueNumber = extractIssueNumberFromBranch;

/**
 * Find a project item by issue number
 */
export function findItemByNumber(
    items: NormalizedProjectItem[],
    issueNumber: number
): NormalizedProjectItem | null {
    return items.find((item) => item.number === issueNumber) || null;
}

/**
 * Trigger status update when a PR is opened
 * Called manually by user or could be automated
 */
export async function handlePROpened(
    api: GitHubAPI,
    project: ProjectWithViews,
    item: NormalizedProjectItem
): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('ghProjects');
    const targetStatus = config.get<string>('prOpenedStatus', 'In Review');

    if (!targetStatus) {
        return false; // No status configured
    }

    // Don't change if already at target status
    if (item.status?.toLowerCase() === targetStatus.toLowerCase()) {
        return false;
    }

    return await updateItemToStatus(api, project, item, targetStatus, 'PR Opened');
}

/**
 * Trigger status update when a PR is merged
 */
export async function handlePRMerged(
    api: GitHubAPI,
    project: ProjectWithViews,
    item: NormalizedProjectItem
): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('ghProjects');
    const targetStatus = config.get<string>('prMergedStatus', 'Done');

    if (!targetStatus) {
        return false; // No status configured
    }

    // Don't change if already at target status
    if (item.status?.toLowerCase() === targetStatus.toLowerCase()) {
        return false;
    }

    return await updateItemToStatus(api, project, item, targetStatus, 'PR Merged');
}

/**
 * Helper to update item status with feedback
 */
async function updateItemToStatus(
    api: GitHubAPI,
    project: ProjectWithViews,
    item: NormalizedProjectItem,
    targetStatus: string,
    reason: string
): Promise<boolean> {
    const statusInfo = api.findStatusFieldAndOption(project, targetStatus);

    if (!statusInfo) {
        vscode.window.showWarningMessage(
            `Status "${targetStatus}" not found. Check your ghProjects.${reason === 'PR Opened' ? 'prOpenedStatus' : 'prMergedStatus'} setting.`
        );
        return false;
    }

    try {
        const success = await api.updateItemStatus(
            project.id,
            item.id,
            statusInfo.fieldId,
            statusInfo.optionId
        );

        if (success) {
            vscode.window.showInformationMessage(
                `${reason}: Moved "${item.title}" to "${targetStatus}"`
            );
        }
        return success;
    } catch (error) {
        vscode.window.showWarningMessage(`Failed to update status: ${error}`);
        return false;
    }
}

/**
 * Command handler: Mark PR as opened for current branch's issue
 */
export async function executePROpened(
    api: GitHubAPI,
    projects: ProjectWithViews[]
): Promise<boolean> {
    // Get current branch
    const branchName = await getCurrentBranch();
    if (!branchName) {
        vscode.window.showErrorMessage('Could not determine current branch');
        return false;
    }

    // Extract issue number from branch
    const issueNumber = extractIssueNumber(branchName);
    if (!issueNumber) {
        vscode.window.showWarningMessage(
            `Could not find issue number in branch name "${branchName}". ` +
            `Expected pattern like "user/123-feature" or "123-fix-bug".`
        );
        return false;
    }

    // Find the item across all projects
    for (const project of projects) {
        const items = await api.getProjectItems(project.id);
        const item = findItemByNumber(items, issueNumber);

        if (item) {
            return await handlePROpened(api, project, item);
        }
    }

    vscode.window.showWarningMessage(
        `Issue #${issueNumber} not found in any project. Make sure it's added to a GitHub Project.`
    );
    return false;
}

/**
 * Check and update items based on their PR status
 * Called during refresh to auto-transition statuses
 */
export async function checkPRStatusTransitions(
    api: GitHubAPI,
    project: ProjectWithViews,
    items: NormalizedProjectItem[]
): Promise<number> {
    const config = vscode.workspace.getConfiguration('ghProjects');
    const prOpenedStatus = config.get<string>('prOpenedStatus', 'In Review');
    const prMergedStatus = config.get<string>('prMergedStatus', 'Done');

    // Skip if no transitions configured
    if (!prOpenedStatus && !prMergedStatus) {
        return 0;
    }

    let transitionCount = 0;

    for (const item of items) {
        // Skip draft issues and items without URLs
        if (item.type === 'draft' || !item.url) {
            continue;
        }

        // Skip if already at merged status
        if (item.status?.toLowerCase() === prMergedStatus?.toLowerCase()) {
            continue;
        }

        try {
            // Check if there's a PR for this issue
            const prInfo = await api.findPRForIssue(item);

            if (prInfo) {
                if (prInfo.merged && prMergedStatus) {
                    // PR was merged - move to merged status
                    if (item.status?.toLowerCase() !== prMergedStatus.toLowerCase()) {
                        const success = await handlePRMerged(api, project, item);
                        if (success) transitionCount++;
                    }
                } else if (!prInfo.merged && prInfo.state === 'open' && prOpenedStatus) {
                    // PR is open - move to review status (but only if not already there)
                    if (item.status?.toLowerCase() !== prOpenedStatus.toLowerCase()) {
                        const success = await handlePROpened(api, project, item);
                        if (success) transitionCount++;
                    }
                }
            }
        } catch (error) {
            // Silently skip items we can't check
            console.log(`Could not check PR status for item ${item.id}: ${error}`);
        }
    }

    return transitionCount;
}

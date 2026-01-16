import * as vscode from 'vscode';
import { GitHubAPI } from './github-api';
import {
    getGitStatus,
    checkoutBranch,
    pullLatest,
    createBranch,
    branchExists,
    generateBranchName,
} from './git-utils';
import type { NormalizedProjectItem, ProjectWithViews } from './types';
import { getBranchLinker } from './extension';

export interface StartWorkingContext {
    item: NormalizedProjectItem;
    project: ProjectWithViews;
}

/**
 * Execute the "Start Working" workflow
 * 1. Check git status and ensure we're ready to create a branch
 * 2. Create the branch with configured naming
 * 3. Update the project item status if configured
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

    // Step 1: Check git status
    const statusCheckResult = await checkGitStatus(mainBranch);
    if (!statusCheckResult.success) {
        return false;
    }

    // Step 2: Generate and create branch
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
                await linkBranchToIssue(branchName, item);
                vscode.window.showInformationMessage(`Switched to branch: ${branchName}`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to checkout branch: ${error}`);
                return false;
            }
        }
        return action === 'Checkout existing branch';
    }

    // Create the new branch
    try {
        await createBranch(branchName);
        // Auto-link the branch to this issue
        await linkBranchToIssue(branchName, item);
        vscode.window.showInformationMessage(`Created and switched to branch: ${branchName}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create branch: ${error}`);
        return false;
    }

    // Step 3: Update project item status if configured
    if (targetStatus) {
        await updateItemStatus(api, project, item, targetStatus);
    }

    // Step 4: Apply active label to track current work
    await applyActiveLabel(api, item);

    return true;
}

/**
 * Check git status and handle any issues interactively
 */
async function checkGitStatus(mainBranch: string): Promise<{ success: boolean }> {
    try {
        const status = await getGitStatus(mainBranch);

        // Check for uncommitted changes
        if (status.hasUncommittedChanges) {
            const action = await vscode.window.showWarningMessage(
                'You have uncommitted changes. Stash or commit them before creating a new branch.',
                'Continue anyway',
                'Cancel'
            );
            if (action !== 'Continue anyway') {
                return { success: false };
            }
        }

        // Check if on main branch
        if (!status.isOnMainBranch) {
            const action = await vscode.window.showWarningMessage(
                `You're on branch "${status.currentBranch}" instead of "${mainBranch}".`,
                `Switch to ${mainBranch}`,
                'Create from current branch',
                'Cancel'
            );

            if (action === 'Cancel') {
                return { success: false };
            }

            if (action === `Switch to ${mainBranch}`) {
                try {
                    await checkoutBranch(mainBranch);
                    // Re-check status after switching
                    const newStatus = await getGitStatus(mainBranch);
                    if (newStatus.isBehindOrigin) {
                        return await handleBehindOrigin(mainBranch, newStatus.behindCount);
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to switch to ${mainBranch}: ${error}`);
                    return { success: false };
                }
            }
            // If "Create from current branch", continue
        } else if (status.isBehindOrigin) {
            // On main but behind origin
            return await handleBehindOrigin(mainBranch, status.behindCount);
        }

        return { success: true };
    } catch (error) {
        vscode.window.showErrorMessage(`Git status check failed: ${error}`);
        return { success: false };
    }
}

/**
 * Handle the case where main branch is behind origin
 */
async function handleBehindOrigin(
    mainBranch: string,
    behindCount: number
): Promise<{ success: boolean }> {
    const action = await vscode.window.showWarningMessage(
        `Your ${mainBranch} branch is ${behindCount} commit${behindCount > 1 ? 's' : ''} behind origin.`,
        'Pull latest',
        'Continue anyway',
        'Cancel'
    );

    if (action === 'Cancel') {
        return { success: false };
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
            return { success: false };
        }
    }

    return { success: true };
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
async function linkBranchToIssue(branchName: string, item: NormalizedProjectItem): Promise<void> {
    if (!item.number) {
        return; // Can't link without issue number
    }

    try {
        const branchLinker = getBranchLinker();
        await branchLinker.linkBranch(branchName, item.number, item.title, item.id);
    } catch (error) {
        // Non-fatal - just log it
        console.warn('Failed to auto-link branch to issue:', error);
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

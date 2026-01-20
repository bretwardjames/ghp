/**
 * Active label management for ghp CLI.
 *
 * The active label (@username:active) indicates which issue(s) a user is currently
 * working on. This module handles applying and removing the label with awareness
 * of parallel worktree workflows.
 */

import chalk from 'chalk';
import { api, type RepoInfo } from './github-api.js';
import { listWorktrees } from './git-utils.js';
import { getBranchForIssue } from './branch-linker.js';

/**
 * Apply the "actively working" label to an issue.
 *
 * @param repo - Repository information
 * @param issueNumber - The issue number to apply the label to
 * @param exclusive - If true (default), remove label from other issues.
 *                    If false, just add without removing from others (for parallel work).
 */
export async function applyActiveLabel(
    repo: RepoInfo,
    issueNumber: number,
    exclusive: boolean = true
): Promise<void> {
    const activeLabel = api.getActiveLabelName();

    // Ensure the label exists
    await api.ensureLabel(repo, activeLabel);

    // In exclusive mode, remove label from other issues first
    if (exclusive) {
        const issuesWithLabel = await api.findIssuesWithLabel(repo, activeLabel);
        for (const otherIssue of issuesWithLabel) {
            if (otherIssue !== issueNumber) {
                await api.removeLabelFromIssue(repo, otherIssue, activeLabel);
                console.log(chalk.dim(`Removed ${activeLabel} from #${otherIssue}`));
            }
        }
    }

    // Add label to current issue
    const labelAdded = await api.addLabelToIssue(repo, issueNumber, activeLabel);
    if (labelAdded) {
        console.log(chalk.green('✓'), `Applied "${activeLabel}" label`);
    }
}

/**
 * Remove the active label from an issue, but protect other issues that have
 * active worktrees. This is used when completing or moving away from an issue.
 *
 * Logic:
 * - Remove the label from the specified issue
 * - For other issues with the active label, only remove if they don't have
 *   an active worktree
 *
 * @param repo - Repository information
 * @param issueNumber - The issue to remove the label from
 * @param removeFromOthers - If true, also remove from other non-worktree issues
 */
export async function removeActiveLabelSafely(
    repo: RepoInfo,
    issueNumber: number,
    removeFromOthers: boolean = true
): Promise<void> {
    const activeLabel = api.getActiveLabelName();

    // Get all issues with the active label
    const issuesWithLabel = await api.findIssuesWithLabel(repo, activeLabel);

    // If the target issue has the label, remove it
    if (issuesWithLabel.includes(issueNumber)) {
        await api.removeLabelFromIssue(repo, issueNumber, activeLabel);
        console.log(chalk.dim(`Removed ${activeLabel} from #${issueNumber}`));
    }

    // Optionally clean up labels from issues without worktrees
    if (removeFromOthers && issuesWithLabel.length > 1) {
        // Get all worktree branches
        const worktrees = await listWorktrees();
        const worktreeBranches = new Set(
            worktrees
                .filter(wt => wt.branch && !wt.isMain)
                .map(wt => wt.branch!)
        );

        // Check each other issue
        for (const otherIssue of issuesWithLabel) {
            if (otherIssue === issueNumber) continue;

            // Check if this issue's branch has a worktree
            const linkedBranch = await getBranchForIssue(repo, otherIssue);
            if (linkedBranch && worktreeBranches.has(linkedBranch)) {
                // Has active worktree - keep the label
                console.log(chalk.dim(`Keeping ${activeLabel} on #${otherIssue} (has active worktree)`));
                continue;
            }

            // No worktree - remove label (normal exclusive behavior)
            await api.removeLabelFromIssue(repo, otherIssue, activeLabel);
            console.log(chalk.dim(`Removed ${activeLabel} from #${otherIssue}`));
        }
    }
}

/**
 * Get all issues that have the active label and an active worktree.
 * Useful for checking what parallel work is in progress.
 *
 * @param repo - Repository information
 * @returns Array of issue numbers with both active label and worktree
 */
export async function getActiveWorktreeIssues(repo: RepoInfo): Promise<number[]> {
    const activeLabel = api.getActiveLabelName();
    const issuesWithLabel = await api.findIssuesWithLabel(repo, activeLabel);

    if (issuesWithLabel.length === 0) {
        return [];
    }

    // Get all worktree branches
    const worktrees = await listWorktrees();
    const worktreeBranches = new Set(
        worktrees
            .filter(wt => wt.branch && !wt.isMain)
            .map(wt => wt.branch!)
    );

    // Filter to issues with worktrees
    const result: number[] = [];
    for (const issueNumber of issuesWithLabel) {
        const linkedBranch = await getBranchForIssue(repo, issueNumber);
        if (linkedBranch && worktreeBranches.has(linkedBranch)) {
            result.push(issueNumber);
        }
    }

    return result;
}

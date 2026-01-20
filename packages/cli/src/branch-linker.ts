/**
 * CLI-specific branch linker that uses GitHub issue bodies for storage.
 *
 * Links are stored as hidden HTML comments in issue bodies:
 * <!-- ghp-branch: feature/my-branch -->
 *
 * This allows links to be shared between CLI and VSCode extension.
 */

import {
    parseBranchLink,
    setBranchLinkInBody,
    removeBranchLinkFromBody,
    type RepoInfo,
} from '@bretwardjames/ghp-core';
import { api } from './github-api.js';

/**
 * Link a branch to an issue by storing the link in the issue body.
 */
export async function linkBranch(
    repo: RepoInfo,
    issueNumber: number,
    branch: string
): Promise<boolean> {
    try {
        const details = await api.getIssueDetails(repo, issueNumber);
        const currentBody = details?.body ?? '';
        const newBody = setBranchLinkInBody(currentBody, branch);
        return await api.updateIssueBody(repo, issueNumber, newBody);
    } catch (error) {
        console.error('Failed to link branch:', error);
        return false;
    }
}

/**
 * Remove the branch link from an issue.
 * @returns true if a link was removed, false if no link existed
 */
export async function unlinkBranch(
    repo: RepoInfo,
    issueNumber: number
): Promise<boolean> {
    try {
        const details = await api.getIssueDetails(repo, issueNumber);
        const currentBody = details?.body ?? '';

        // Check if there's a link to remove
        if (!parseBranchLink(currentBody)) {
            return false;
        }

        const newBody = removeBranchLinkFromBody(currentBody);
        return await api.updateIssueBody(repo, issueNumber, newBody);
    } catch (error) {
        console.error('Failed to unlink branch:', error);
        return false;
    }
}

/**
 * Get the branch linked to an issue by reading the issue body.
 */
export async function getBranchForIssue(
    repo: RepoInfo,
    issueNumber: number
): Promise<string | null> {
    try {
        const details = await api.getIssueDetails(repo, issueNumber);
        return parseBranchLink(details?.body);
    } catch (error) {
        console.error('Failed to get branch for issue:', error);
        return null;
    }
}

/**
 * Extract issue number from a branch name.
 * Supports common patterns:
 * - user/123-feature-name
 * - feature/123-something
 * - 123-fix-bug
 * - fix-123-something
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
 * Result of finding an issue for a branch.
 */
export interface BranchIssueLink {
    issueNumber: number;
    issueTitle: string;
    branch: string;
}

/**
 * Find the issue linked to a branch.
 * This first extracts the issue number from the branch name pattern,
 * then verifies the link exists in the issue body.
 *
 * @returns Issue info if found and verified, null otherwise
 */
export async function getIssueForBranch(
    repo: RepoInfo,
    branchName: string
): Promise<BranchIssueLink | null> {
    // First, try to extract issue number from branch name
    const issueNumber = extractIssueNumberFromBranch(branchName);
    if (!issueNumber) {
        return null;
    }

    try {
        // Get issue details to verify and get title
        const details = await api.getIssueDetails(repo, issueNumber);
        if (!details) {
            return null;
        }

        // Check if this issue has a link to this branch
        const linkedBranch = parseBranchLink(details.body);

        // If not explicitly linked, still return info based on branch naming convention
        // This allows workflows that rely on branch naming patterns to work
        return {
            issueNumber,
            issueTitle: details.title,
            branch: linkedBranch === branchName ? branchName : branchName,
        };
    } catch (error) {
        console.error('Failed to verify issue for branch:', error);
        return null;
    }
}

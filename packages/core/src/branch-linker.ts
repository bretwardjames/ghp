/**
 * Branch-issue linking stored directly in GitHub issue bodies.
 *
 * Links are stored as hidden HTML comments in the issue body:
 * <!-- ghp-branch: feature/my-branch -->
 *
 * This allows branch links to be shared across all consumers (CLI, VSCode, etc.)
 * since they're stored on GitHub itself.
 */

import type { GitHubAPI } from './github-api.js';
import type { RepoInfo } from './types.js';

const BRANCH_LINK_PATTERN = /<!--\s*ghp-branch:\s*(.+?)\s*-->/;

/**
 * Parse the linked branch from an issue body.
 */
export function parseBranchLink(body: string | null | undefined): string | null {
    if (!body) return null;
    const match = body.match(BRANCH_LINK_PATTERN);
    return match ? match[1].trim() : null;
}

/**
 * Set or update the branch link in an issue body.
 * Returns the updated body string.
 */
export function setBranchLinkInBody(body: string | null | undefined, branch: string): string {
    const currentBody = body || '';
    const tag = `<!-- ghp-branch: ${branch} -->`;

    if (BRANCH_LINK_PATTERN.test(currentBody)) {
        // Replace existing tag
        return currentBody.replace(BRANCH_LINK_PATTERN, tag);
    } else {
        // Append tag at the end
        return currentBody.trim() + '\n\n' + tag;
    }
}

/**
 * Remove the branch link from an issue body.
 * Returns the updated body string.
 */
export function removeBranchLinkFromBody(body: string | null | undefined): string {
    if (!body) return '';
    return body.replace(BRANCH_LINK_PATTERN, '').trim();
}

/**
 * Manages branch-issue links stored in GitHub issue bodies.
 */
export class BranchLinker {
    private api: GitHubAPI;

    constructor(api: GitHubAPI) {
        this.api = api;
    }

    /**
     * Create a link between a branch and an issue.
     * Stores the link as a hidden comment in the issue body.
     */
    async link(repo: RepoInfo, issueNumber: number, branch: string): Promise<boolean> {
        const details = await this.api.getIssueDetails(repo, issueNumber);
        if (!details) return false;

        const newBody = setBranchLinkInBody(details.body, branch);
        return this.api.updateIssueBody(repo, issueNumber, newBody);
    }

    /**
     * Remove the branch link from an issue.
     */
    async unlink(repo: RepoInfo, issueNumber: number): Promise<boolean> {
        const details = await this.api.getIssueDetails(repo, issueNumber);
        if (!details) return false;

        const currentBranch = parseBranchLink(details.body);
        if (!currentBranch) return false; // No link to remove

        const newBody = removeBranchLinkFromBody(details.body);
        return this.api.updateIssueBody(repo, issueNumber, newBody);
    }

    /**
     * Get the branch linked to an issue.
     */
    async getBranchForIssue(repo: RepoInfo, issueNumber: number): Promise<string | null> {
        const details = await this.api.getIssueDetails(repo, issueNumber);
        if (!details) return null;
        return parseBranchLink(details.body);
    }

    /**
     * Check if an issue has a branch link.
     */
    async hasLink(repo: RepoInfo, issueNumber: number): Promise<boolean> {
        const branch = await this.getBranchForIssue(repo, issueNumber);
        return branch !== null;
    }
}

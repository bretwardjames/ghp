/**
 * URL parsing utilities for GitHub repositories and issues.
 */

import type { RepoInfo } from './types.js';

/**
 * Parse a GitHub URL into owner and repo name.
 * Supports both SSH and HTTPS formats.
 *
 * @example
 * parseGitHubUrl('git@github.com:owner/repo.git')
 * // => { owner: 'owner', name: 'repo', fullName: 'owner/repo' }
 *
 * @example
 * parseGitHubUrl('https://github.com/owner/repo')
 * // => { owner: 'owner', name: 'repo', fullName: 'owner/repo' }
 */
export function parseGitHubUrl(url: string): RepoInfo | null {
    // Handle SSH format: git@github.com:owner/repo.git
    const sshMatch = url.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
    if (sshMatch) {
        return {
            owner: sshMatch[1],
            name: sshMatch[2],
            fullName: `${sshMatch[1]}/${sshMatch[2]}`,
        };
    }

    // Handle HTTPS format: https://github.com/owner/repo.git
    const httpsMatch = url.match(/https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (httpsMatch) {
        return {
            owner: httpsMatch[1],
            name: httpsMatch[2],
            fullName: `${httpsMatch[1]}/${httpsMatch[2]}`,
        };
    }

    return null;
}

/**
 * Parse a GitHub issue/PR URL to extract repo and number.
 *
 * @example
 * parseIssueUrl('https://github.com/owner/repo/issues/123')
 * // => { owner: 'owner', repo: 'repo', number: 123, type: 'issue' }
 */
export function parseIssueUrl(
    url: string
): { owner: string; repo: string; number: number; type: 'issue' | 'pull' } | null {
    const match = url.match(
        /https:\/\/github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/
    );
    if (match) {
        return {
            owner: match[1],
            repo: match[2],
            number: parseInt(match[4], 10),
            type: match[3] === 'pull' ? 'pull' : 'issue',
        };
    }
    return null;
}

/**
 * Build a GitHub issue URL from components.
 */
export function buildIssueUrl(owner: string, repo: string, number: number): string {
    return `https://github.com/${owner}/${repo}/issues/${number}`;
}

/**
 * Build a GitHub pull request URL from components.
 */
export function buildPullRequestUrl(owner: string, repo: string, number: number): string {
    return `https://github.com/${owner}/${repo}/pull/${number}`;
}

/**
 * Build a GitHub repository URL from components.
 */
export function buildRepoUrl(owner: string, repo: string): string {
    return `https://github.com/${owner}/${repo}`;
}

/**
 * Build a GitHub project URL from components.
 */
export function buildProjectUrl(owner: string, projectNumber: number): string {
    return `https://github.com/users/${owner}/projects/${projectNumber}`;
}

/**
 * Build an organization project URL.
 */
export function buildOrgProjectUrl(org: string, projectNumber: number): string {
    return `https://github.com/orgs/${org}/projects/${projectNumber}`;
}

/**
 * Branch-issue linking for VSCode extension.
 *
 * Uses @bretwardjames/ghp-core helper functions to store branch links
 * as hidden HTML comments in GitHub issue bodies:
 * <!-- ghp-branch: feature/my-branch -->
 *
 * This allows branch links to be shared between CLI and VSCode extension.
 */

import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
    parseBranchLink,
    setBranchLinkInBody,
    removeBranchLinkFromBody,
} from '@bretwardjames/ghp-core';
import type { GitHubAPI } from './github-api';
import { getCurrentBranch, hasUncommittedChanges } from './git-utils';

const execAsync = promisify(exec);

/**
 * Get the workspace path for git operations.
 */
function getWorkspacePath(): string | null {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    return workspaceFolder?.uri.fsPath || null;
}

/**
 * VSCode BranchLinker that stores branch-issue links in GitHub issue bodies.
 */
export class BranchLinker {
    private _api: GitHubAPI;
    private _getRepo: () => { owner: string; name: string } | null;

    constructor(
        api: GitHubAPI,
        getRepo: () => { owner: string; name: string } | null
    ) {
        this._api = api;
        this._getRepo = getRepo;
    }

    /**
     * Link a branch to an issue by storing the link in the issue body.
     */
    async linkBranch(
        branchName: string,
        issueNumber: number
    ): Promise<boolean> {
        const repo = this._getRepo();
        if (!repo) {
            vscode.window.showErrorMessage('No repository detected');
            return false;
        }

        try {
            // Get current issue body
            const currentBody = await this._api.getIssueBody(repo.owner, repo.name, issueNumber);

            // Update body with branch link
            const newBody = setBranchLinkInBody(currentBody, branchName);

            // Save the updated body
            await this._api.updateIssueBody(repo.owner, repo.name, issueNumber, newBody);
            return true;
        } catch (error) {
            console.error('Failed to link branch:', error);
            return false;
        }
    }

    /**
     * Get the branch linked to an issue by reading the issue body.
     */
    async getBranchForIssue(issueNumber: number): Promise<string | null> {
        const repo = this._getRepo();
        if (!repo) {
            return null;
        }

        try {
            const body = await this._api.getIssueBody(repo.owner, repo.name, issueNumber);
            return parseBranchLink(body);
        } catch (error) {
            console.error('Failed to get branch for issue:', error);
            return null;
        }
    }

    /**
     * Remove the branch link from an issue.
     */
    async unlinkBranch(issueNumber: number): Promise<boolean> {
        const repo = this._getRepo();
        if (!repo) {
            vscode.window.showErrorMessage('No repository detected');
            return false;
        }

        try {
            // Get current issue body
            const currentBody = await this._api.getIssueBody(repo.owner, repo.name, issueNumber);

            // Check if there's a link to remove
            if (!parseBranchLink(currentBody)) {
                return false; // No link to remove
            }

            // Remove the branch link
            const newBody = removeBranchLinkFromBody(currentBody);

            // Save the updated body
            await this._api.updateIssueBody(repo.owner, repo.name, issueNumber, newBody);
            return true;
        } catch (error) {
            console.error('Failed to unlink branch:', error);
            return false;
        }
    }

    /**
     * Check if an issue has a branch link.
     */
    async hasLink(issueNumber: number): Promise<boolean> {
        const branch = await this.getBranchForIssue(issueNumber);
        return branch !== null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Git Operations (local operations, not related to GitHub API)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get current git branch name.
     */
    async getCurrentBranch(): Promise<string | null> {
        try {
            const branch = await getCurrentBranch();
            return branch === 'HEAD' ? null : branch;
        } catch {
            return null;
        }
    }

    /**
     * Get all local branches.
     */
    async getLocalBranches(): Promise<string[]> {
        const cwd = getWorkspacePath();
        if (!cwd) {
            return [];
        }

        try {
            const { stdout } = await execAsync('git branch --format="%(refname:short)"', { cwd });
            return stdout
                .split('\n')
                .map(b => b.trim())
                .filter(b => b.length > 0);
        } catch {
            return [];
        }
    }

    /**
     * Get all remote branches (excluding HEAD).
     */
    async getRemoteBranches(): Promise<string[]> {
        const cwd = getWorkspacePath();
        if (!cwd) {
            return [];
        }

        try {
            // Fetch latest remote info first
            await execAsync('git fetch --prune', { cwd });

            const { stdout } = await execAsync('git branch -r --format="%(refname:short)"', { cwd });
            return stdout
                .split('\n')
                .map(b => b.trim())
                .filter(b => b.length > 0 && !b.includes('HEAD'))
                .map(b => b.replace(/^origin\//, '')); // Strip origin/ prefix
        } catch {
            return [];
        }
    }

    /**
     * Get all branches (local + remote, deduplicated).
     */
    async getAllBranches(): Promise<string[]> {
        const [local, remote] = await Promise.all([
            this.getLocalBranches(),
            this.getRemoteBranches(),
        ]);

        // Combine and deduplicate, with local branches first
        const all = new Set<string>(local);
        for (const b of remote) {
            all.add(b);
        }
        return Array.from(all);
    }

    /**
     * Check if the current branch is pushed to remote.
     */
    async isCurrentBranchPushed(): Promise<{ pushed: boolean; branchName: string | null }> {
        const cwd = getWorkspacePath();
        if (!cwd) {
            return { pushed: false, branchName: null };
        }

        try {
            const branchName = await this.getCurrentBranch();
            if (!branchName) {
                return { pushed: false, branchName: null };
            }

            // Check if there's a remote tracking branch
            const { stdout } = await execAsync(
                `git rev-parse --abbrev-ref ${branchName}@{upstream} 2>/dev/null || echo ""`,
                { cwd }
            );

            return { pushed: stdout.trim().length > 0, branchName };
        } catch {
            const branchName = await this.getCurrentBranch();
            return { pushed: false, branchName };
        }
    }

    /**
     * Push current branch to remote.
     */
    async pushCurrentBranch(): Promise<{ success: boolean; error?: string }> {
        const cwd = getWorkspacePath();
        if (!cwd) {
            return { success: false, error: 'No workspace folder' };
        }

        try {
            const branchName = await this.getCurrentBranch();
            if (!branchName) {
                return { success: false, error: 'Not on a branch' };
            }

            await execAsync(`git push -u origin "${branchName}"`, { cwd });

            return { success: true };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    /**
     * Check if a branch exists locally.
     */
    async branchExists(branchName: string): Promise<boolean> {
        const branches = await this.getLocalBranches();
        return branches.includes(branchName);
    }

    /**
     * Check if a branch exists on remote.
     */
    async remoteBranchExists(branchName: string): Promise<boolean> {
        const branches = await this.getRemoteBranches();
        return branches.includes(branchName);
    }

    /**
     * Switch to a branch (handles both local and remote branches).
     * Includes VSCode-specific UI for uncommitted changes.
     */
    async switchToBranch(branchName: string): Promise<{ success: boolean; error?: string }> {
        const cwd = getWorkspacePath();
        if (!cwd) {
            return { success: false, error: 'No workspace folder open' };
        }

        try {
            // Check for uncommitted changes using core utility
            const uncommitted = await hasUncommittedChanges();

            if (uncommitted) {
                // There are uncommitted changes - ask user what to do
                const choice = await vscode.window.showWarningMessage(
                    'You have uncommitted changes. What would you like to do?',
                    'Stash and Switch',
                    'Switch Anyway',
                    'Cancel'
                );

                if (choice === 'Cancel' || !choice) {
                    return { success: false, error: 'Cancelled by user' };
                }

                if (choice === 'Stash and Switch') {
                    await execAsync('git stash push -m "Auto-stash before switching to ' + branchName + '"', { cwd });
                }
            }

            // Check if branch exists locally
            const localBranches = await this.getLocalBranches();
            const existsLocally = localBranches.includes(branchName);

            if (existsLocally) {
                // Simple checkout
                await execAsync(`git checkout "${branchName}"`, { cwd });
            } else {
                // Check if it exists on remote
                const remoteBranches = await this.getRemoteBranches();
                const existsRemotely = remoteBranches.includes(branchName);

                if (existsRemotely) {
                    // Create local tracking branch from remote
                    await execAsync(`git checkout -b "${branchName}" "origin/${branchName}"`, { cwd });
                } else {
                    return { success: false, error: `Branch "${branchName}" not found locally or on remote` };
                }
            }

            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message };
        }
    }
}

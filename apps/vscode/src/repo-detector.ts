import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { parseGitHubUrl, type RepoInfo } from '@bretwardjames/ghp-core';

const execAsync = promisify(exec);

// Re-export RepoInfo for consumers
export type { RepoInfo };

/**
 * Detects the GitHub repository from the current workspace
 * by parsing git remote URLs
 */
export async function detectRepository(): Promise<RepoInfo | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return null;
    }

    const workspacePath = workspaceFolders[0].uri.fsPath;

    try {
        // Try to get the origin remote URL
        const { stdout } = await execAsync('git remote get-url origin', {
            cwd: workspacePath,
        });

        const remoteUrl = stdout.trim();
        return parseGitHubUrl(remoteUrl);
    } catch {
        // Not a git repo or no origin remote
        return null;
    }
}

/**
 * Check if the detected owner is an organization or user
 */
export async function getOwnerType(
    owner: string,
    graphqlClient: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>
): Promise<'organization' | 'user' | null> {
    try {
        // Try organization first
        await graphqlClient<{ organization: { id: string } }>(
            `query($login: String!) {
                organization(login: $login) {
                    id
                }
            }`,
            { login: owner }
        );
        return 'organization';
    } catch {
        // Try user
        try {
            await graphqlClient<{ user: { id: string } }>(
                `query($login: String!) {
                    user(login: $login) {
                        id
                    }
                }`,
                { login: owner }
            );
            return 'user';
        } catch {
            return null;
        }
    }
}

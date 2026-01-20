import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface RepoInfo {
    owner: string;
    name: string;
    fullName: string; // owner/name
}

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
 * Parse a GitHub URL (HTTPS or SSH) to extract owner/repo
 */
function parseGitHubUrl(url: string): RepoInfo | null {
    // SSH format: git@github.com:owner/repo.git
    const sshMatch = url.match(/git@github\.com:([^/]+)\/(.+?)(\.git)?$/);
    if (sshMatch) {
        return {
            owner: sshMatch[1],
            name: sshMatch[2],
            fullName: `${sshMatch[1]}/${sshMatch[2]}`,
        };
    }

    // HTTPS format: https://github.com/owner/repo.git
    const httpsMatch = url.match(/https?:\/\/github\.com\/([^/]+)\/(.+?)(\.git)?$/);
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

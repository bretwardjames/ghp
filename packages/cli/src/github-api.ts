/**
 * CLI-specific GitHub API wrapper.
 *
 * This module wraps the core GitHubAPI class with CLI-specific behavior:
 * - Token from `gh auth token` or environment variables
 * - Chalk-colored error messages
 * - process.exit on auth errors
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import {
    GitHubAPI as CoreGitHubAPI,
    type TokenProvider,
    type AuthError,
} from '@bretwardjames/ghp-core';

const execAsync = promisify(exec);

/**
 * CLI token provider that gets tokens from environment or gh CLI
 */
const cliTokenProvider: TokenProvider = {
    async getToken(): Promise<string | null> {
        // First try environment variables
        if (process.env.GITHUB_TOKEN) {
            return process.env.GITHUB_TOKEN;
        }
        if (process.env.GH_TOKEN) {
            return process.env.GH_TOKEN;
        }

        // Try gh CLI
        try {
            const { stdout } = await execAsync('gh auth token');
            return stdout.trim();
        } catch {
            return null;
        }
    },
};

/**
 * CLI error handler that prints colored messages and exits
 */
function handleAuthError(error: AuthError): void {
    if (error.type === 'INSUFFICIENT_SCOPES') {
        console.error(chalk.red('\nError:'), 'Your GitHub token is missing required scopes.');
        console.error(chalk.dim('GitHub Projects requires the'), chalk.cyan('read:project'), chalk.dim('scope.'));
        console.error();
        console.error('Run this command to add the required scope:');
        console.error(chalk.cyan('  gh auth refresh -s read:project -s project'));
        console.error();
    } else if (error.type === 'SSO_REQUIRED') {
        console.error(chalk.red('\nError:'), 'SSO authentication required for this organization.');
        console.error(chalk.dim('Please re-authenticate with SSO enabled.'));
        console.error();
    } else {
        console.error(chalk.red('\nError:'), error.message);
    }
    process.exit(1);
}

/**
 * Extended GitHubAPI class for CLI with pre-configured token provider
 */
class CLIGitHubAPI extends CoreGitHubAPI {
    constructor() {
        super({
            tokenProvider: cliTokenProvider,
            onAuthError: handleAuthError,
        });
    }
}

// Re-export types that consumers might need
export type {
    RepoInfo,
    Project,
    ProjectItem,
    StatusField,
    IssueDetails,
    Collaborator,
    IssueReference,
} from '@bretwardjames/ghp-core';

// Singleton instance for CLI usage
export const api = new CLIGitHubAPI();

// Also export the class for testing
export { CLIGitHubAPI as GitHubAPI };

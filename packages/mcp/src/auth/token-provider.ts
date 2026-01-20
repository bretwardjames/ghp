import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { TokenProvider } from '@bretwardjames/ghp-core';

const execAsync = promisify(exec);

/**
 * Creates a TokenProvider that reads GitHub tokens from environment variables
 * or falls back to the gh CLI.
 *
 * Priority order:
 * 1. GITHUB_TOKEN environment variable
 * 2. GH_TOKEN environment variable
 * 3. `gh auth token` command output
 */
export function createTokenProvider(): TokenProvider {
    return {
        async getToken(): Promise<string | null> {
            // Try environment variables first
            if (process.env.GITHUB_TOKEN) {
                return process.env.GITHUB_TOKEN;
            }
            if (process.env.GH_TOKEN) {
                return process.env.GH_TOKEN;
            }

            // Fall back to gh CLI
            try {
                const { stdout } = await execAsync('gh auth token');
                const token = stdout.trim();
                return token || null;
            } catch {
                // gh CLI not installed or not authenticated
                return null;
            }
        },
    };
}

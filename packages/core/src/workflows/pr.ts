/**
 * PR Workflows
 *
 * Centralized pull request operations with hook firing.
 * Used by CLI, MCP, VS Code extension, and nvim plugin.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { getCurrentBranch } from '../git-utils.js';
import { executeHooksForEvent, hasHooksForEvent } from '../plugins/executor.js';
import type { PrCreatedPayload, HookResult } from '../plugins/types.js';
import type {
    CreatePROptions,
    CreatePRResult,
    PRInfo,
    IssueInfo,
} from './types.js';

const execAsync = promisify(exec);

// =============================================================================
// Create PR Workflow
// =============================================================================

/**
 * Create a pull request and fire the pr-created hook.
 *
 * This workflow:
 * 1. Creates the PR using gh CLI
 * 2. Fires the pr-created hook
 *
 * Note: This workflow uses the `gh` CLI for PR creation since the GitHub
 * GraphQL API for PR creation is more complex and gh handles edge cases well.
 *
 * @example
 * ```typescript
 * const result = await createPRWorkflow({
 *   repo: { owner: 'user', name: 'repo', fullName: 'user/repo' },
 *   title: 'Add new feature',
 *   body: 'Description of changes',
 *   issueNumber: 123,
 * });
 *
 * if (result.success) {
 *   console.log(`Created PR #${result.pr.number}: ${result.pr.url}`);
 * }
 * ```
 */
export async function createPRWorkflow(
    options: CreatePROptions
): Promise<CreatePRResult> {
    const {
        repo,
        title,
        body = '',
        baseBranch = 'main',
        headBranch,
        issueNumber,
        openInBrowser = false,
    } = options;

    const hookResults: HookResult[] = [];

    try {
        // Get current branch if head branch not specified
        const head = headBranch || await getCurrentBranch();
        if (!head) {
            return {
                success: false,
                error: 'Could not determine current branch',
                hookResults,
            };
        }

        // Build gh pr create command
        const args: string[] = ['gh', 'pr', 'create'];

        // Escape shell special characters in strings
        const escapeShell = (str: string) => str.replace(/([`$\\"])/g, '\\$1');

        args.push('--title', `"${escapeShell(title)}"`);

        // Use heredoc for body to handle multi-line content safely
        const bodyContent = body || (issueNumber ? `Relates to #${issueNumber}` : '');

        args.push('--base', baseBranch);
        args.push('--head', head);

        if (openInBrowser) {
            args.push('--web');
        }

        // Build the command with heredoc for body
        const command = bodyContent
            ? `${args.join(' ')} --body "$(cat <<'EOF'\n${bodyContent}\nEOF\n)"`
            : args.join(' ');

        // Create the PR
        const { stdout, stderr } = await execAsync(command);

        // Parse PR URL from output to get PR number
        // gh pr create outputs the PR URL
        const prUrlMatch = stdout.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/(\d+)/);
        let prNumber = 0;
        let prUrl = '';

        if (prUrlMatch) {
            prNumber = parseInt(prUrlMatch[1], 10);
            prUrl = prUrlMatch[0];
        } else {
            // Try to get PR info from gh pr view
            try {
                const { stdout: viewOutput } = await execAsync('gh pr view --json number,url');
                const prData = JSON.parse(viewOutput);
                prNumber = prData.number;
                prUrl = prData.url;
            } catch {
                // PR was created but we couldn't get details
                // Return success with partial info
            }
        }

        const prInfo: PRInfo = {
            number: prNumber,
            title,
            body: bodyContent,
            url: prUrl || `https://github.com/${repo.owner}/${repo.name}/pull/${prNumber}`,
        };

        // Build issue info if linked
        let issueInfo: IssueInfo | undefined;
        if (issueNumber) {
            issueInfo = {
                number: issueNumber,
                title: '', // We don't have the issue title here
                url: `https://github.com/${repo.owner}/${repo.name}/issues/${issueNumber}`,
            };
        }

        // Fire pr-created hook
        if (hasHooksForEvent('pr-created')) {
            const payload: PrCreatedPayload = {
                repo: `${repo.owner}/${repo.name}`,
                pr: {
                    number: prNumber,
                    title,
                    body: bodyContent,
                    url: prInfo.url,
                },
                branch: head,
            };

            // Add issue info if linked
            if (issueNumber) {
                payload.issue = {
                    number: issueNumber,
                    title: '', // Not available without additional API call
                    body: '',
                    url: `https://github.com/${repo.owner}/${repo.name}/issues/${issueNumber}`,
                };
            }

            const results = await executeHooksForEvent('pr-created', payload);
            hookResults.push(...results);
        }

        return {
            success: true,
            pr: prInfo,
            issue: issueInfo,
            hookResults,
        };
    } catch (error) {
        const err = error as { stderr?: string; message?: string };

        // Check if PR already exists
        if (err.stderr?.includes('already exists')) {
            return {
                success: false,
                error: 'A pull request already exists for this branch',
                hookResults,
            };
        }

        return {
            success: false,
            error: err.stderr || err.message || String(error),
            hookResults,
        };
    }
}

/**
 * PR Workflows
 *
 * Centralized pull request operations with hook firing.
 * Used by CLI, MCP, VS Code extension, and nvim plugin.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { getCurrentBranch } from '../git-utils.js';
import { executeHooksForEvent, hasHooksForEvent, shouldAbort } from '../plugins/executor.js';
import type {
    PrePrPayload,
    PrCreatingPayload,
    PrCreatedPayload,
    HookResult,
} from '../plugins/types.js';
import { getDiffStats, getChangedFiles } from '../dashboard/index.js';
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
 * Create a pull request with full lifecycle hook support.
 *
 * This workflow:
 * 1. Fires pre-pr hooks (validation/linting) - can abort if blocking
 * 2. Fires pr-creating hooks (suggest title/body) - can abort if blocking
 * 3. Creates the PR using gh CLI
 * 4. Fires pr-created hooks (fire-and-forget)
 *
 * Hook behavior:
 * - pre-pr: Receives changed files and diff stats for validation
 * - pr-creating: Receives proposed title/body for review
 * - pr-created: Receives final PR info after creation
 *
 * Use `skipHooks: true` to skip all hooks (--no-hooks flag).
 * Use `force: true` to continue even if blocking hooks fail (--force flag).
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
 * } else if (result.abortedByHook) {
 *   console.log(`Aborted by ${result.abortedAtEvent} hook: ${result.abortedByHook}`);
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
        issueTitle,
        openInBrowser = false,
        skipHooks = false,
        force = false,
    } = options;

    const hookResults: HookResult[] = [];
    const repoFullName = `${repo.owner}/${repo.name}`;

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

        // =================================================================
        // Fire pre-pr hooks (validation/linting before PR creation)
        // =================================================================
        if (!skipHooks && hasHooksForEvent('pre-pr')) {
            // Gather diff stats and changed files for the payload
            const [diffStats, changedFiles] = await Promise.all([
                getDiffStats(baseBranch),
                getChangedFiles(baseBranch),
            ]);

            const prePrPayload: PrePrPayload = {
                repo: repoFullName,
                branch: head,
                base: baseBranch,
                changed_files: changedFiles.map(f => f.path),
                diff_stat: {
                    additions: diffStats.insertions,
                    deletions: diffStats.deletions,
                    files_changed: diffStats.filesChanged,
                },
            };

            const prePrResults = await executeHooksForEvent('pre-pr', prePrPayload);
            hookResults.push(...prePrResults);

            // Check if any hook signaled abort (unless --force)
            if (!force && shouldAbort(prePrResults)) {
                const abortingHook = prePrResults.find(r => r.aborted);
                return {
                    success: false,
                    error: `PR creation aborted by pre-pr hook "${abortingHook?.hookName}"`,
                    hookResults,
                    abortedByHook: abortingHook?.hookName,
                    abortedAtEvent: 'pre-pr',
                };
            }
        }

        // =================================================================
        // Fire pr-creating hooks (suggest title/body modifications)
        // =================================================================
        const bodyContent = body || (issueNumber ? `Relates to #${issueNumber}` : '');

        if (!skipHooks && hasHooksForEvent('pr-creating')) {
            const prCreatingPayload: PrCreatingPayload = {
                repo: repoFullName,
                branch: head,
                base: baseBranch,
                title,
                body: bodyContent,
            };

            const prCreatingResults = await executeHooksForEvent('pr-creating', prCreatingPayload);
            hookResults.push(...prCreatingResults);

            // Check if any hook signaled abort (unless --force)
            if (!force && shouldAbort(prCreatingResults)) {
                const abortingHook = prCreatingResults.find(r => r.aborted);
                return {
                    success: false,
                    error: `PR creation aborted by pr-creating hook "${abortingHook?.hookName}"`,
                    hookResults,
                    abortedByHook: abortingHook?.hookName,
                    abortedAtEvent: 'pr-creating',
                };
            }
        }

        // =================================================================
        // Create the PR via GitHub API
        // =================================================================

        // Build gh pr create command
        const args: string[] = ['gh', 'pr', 'create'];

        // Escape shell special characters in strings
        const escapeShell = (str: string) => str.replace(/([`$\\"])/g, '\\$1');

        args.push('--title', `"${escapeShell(title)}"`);

        // Use heredoc for body to handle multi-line content safely
        // (bodyContent already defined above for pr-creating hooks)

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
                title: issueTitle || '',
                url: `https://github.com/${repo.owner}/${repo.name}/issues/${issueNumber}`,
            };
        }

        // =================================================================
        // Fire pr-created hooks (fire-and-forget, after successful creation)
        // =================================================================
        if (!skipHooks && hasHooksForEvent('pr-created')) {
            const payload: PrCreatedPayload = {
                repo: repoFullName,
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
                    title: issueTitle || '',
                    body: '',
                    url: `https://github.com/${repo.owner}/${repo.name}/issues/${issueNumber}`,
                };
            }

            const results = await executeHooksForEvent('pr-created', payload);
            hookResults.push(...results);
            // Note: pr-created hooks are typically fire-and-forget, so we don't
            // check for abort here - the PR has already been created
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

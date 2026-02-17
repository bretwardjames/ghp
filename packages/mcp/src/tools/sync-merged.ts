import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { execSync } from 'child_process';
import { extractIssueNumberFromBranch } from '@bretwardjames/ghp-core';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';
import { getConfigValue } from '../tool-registry.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'sync_merged_prs',
    category: 'action',
    disabledByDefault: false,
};

/**
 * Extract issue numbers from a PR body (Relates to #N, Closes #N, Fixes #N, etc.)
 */
function extractIssueNumbersFromBody(body: string): number[] {
    const pattern = /(?:relates?\s+to|close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
    const numbers: number[] = [];
    let match;
    while ((match = pattern.exec(body)) !== null) {
        numbers.push(parseInt(match[1], 10));
    }
    return numbers;
}

interface MergedPr {
    number: number;
    title: string;
    headRefName: string;
    body: string;
    url: string;
}

/**
 * Registers the sync_merged_prs tool.
 * Finds merged PRs with linked issues not in prMergedStatus and moves them.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'sync_merged_prs',
        {
            title: 'Sync Merged PRs',
            description:
                'Find issues linked to merged PRs that are not yet in the configured prMergedStatus, and move them.',
            inputSchema: {
                limit: z
                    .number()
                    .optional()
                    .describe('Number of merged PRs to check (default: 50)'),
                dryRun: z
                    .boolean()
                    .optional()
                    .describe('Show what would be moved without making changes'),
            },
        },
        async ({ limit, dryRun }) => {
            const authenticated = await context.ensureAuthenticated();
            if (!authenticated) {
                return {
                    content: [{ type: 'text' as const, text: 'Error: Not authenticated.' }],
                    isError: true,
                };
            }

            const repo = await context.getRepo();
            if (!repo) {
                return {
                    content: [{ type: 'text' as const, text: 'Error: Not in a git repository with a GitHub remote.' }],
                    isError: true,
                };
            }

            try {
                const prMergedStatus = getConfigValue('prMergedStatus', 'Done');
                const checkLimit = limit || 50;

                // Get recently merged PRs
                const stdout = execSync(
                    `gh pr list --state merged --json number,title,headRefName,body,url --limit ${checkLimit}`,
                    { encoding: 'utf-8' }
                );
                const mergedPrs: MergedPr[] = JSON.parse(stdout);

                if (mergedPrs.length === 0) {
                    return {
                        content: [{ type: 'text' as const, text: 'No merged PRs found.' }],
                    };
                }

                // Collect all issue numbers linked to merged PRs
                const issueSet = new Map<number, string>();
                for (const pr of mergedPrs) {
                    const branchIssue = extractIssueNumberFromBranch(pr.headRefName);
                    if (branchIssue) {
                        issueSet.set(branchIssue, `PR #${pr.number}`);
                    }
                    const bodyIssues = extractIssueNumbersFromBody(pr.body || '');
                    for (const num of bodyIssues) {
                        if (!issueSet.has(num)) {
                            issueSet.set(num, `PR #${pr.number}`);
                        }
                    }
                }

                if (issueSet.size === 0) {
                    return {
                        content: [{ type: 'text' as const, text: 'No linked issues found in merged PRs.' }],
                    };
                }

                const lines: string[] = [];
                let moved = 0;
                let skipped = 0;

                for (const [issueNumber, prRef] of issueSet) {
                    const item = await context.api.findItemByNumber(repo, issueNumber);
                    if (!item) continue;

                    if (item.status === prMergedStatus) {
                        skipped++;
                        continue;
                    }

                    if (dryRun) {
                        lines.push(`Would move #${issueNumber} "${item.title}" (${item.status} → ${prMergedStatus}) via ${prRef}`);
                        moved++;
                        continue;
                    }

                    const result = await context.api.moveIssueToStatus(repo, issueNumber, prMergedStatus);
                    if (result.success) {
                        lines.push(`Moved #${issueNumber} "${item.title}" → "${prMergedStatus}" (via ${prRef})`);
                        moved++;
                    } else {
                        lines.push(`Failed #${issueNumber}: ${result.error}`);
                    }
                }

                const summary = dryRun
                    ? `Dry run: ${moved} issue(s) would be moved, ${skipped} already in "${prMergedStatus}"`
                    : `Done: ${moved} moved, ${skipped} already in "${prMergedStatus}"`;

                lines.push('', summary);

                return {
                    content: [{ type: 'text' as const, text: lines.join('\n') }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { execSync } from 'child_process';
import { extractIssueNumberFromBranch } from '@bretwardjames/ghp-core';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';
import { getConfigValue } from '../tool-registry.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'release',
    category: 'action',
    disabledByDefault: false,
};

interface MergedPr {
    number: number;
    title: string;
    headRefName: string;
    body: string;
    url: string;
    mergeCommit: { oid: string } | null;
}

function extractIssueNumbersFromBody(body: string): number[] {
    const pattern = /(?:relates?\s+to|close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
    const numbers: number[] = [];
    let match;
    while ((match = pattern.exec(body)) !== null) {
        numbers.push(parseInt(match[1], 10));
    }
    return numbers;
}

function isAncestor(commit: string, ref: string): boolean {
    try {
        execSync(`git merge-base --is-ancestor ${commit} ${ref}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Registers the release tool.
 * Finds issues linked to merged PRs included in a release ref and moves them to doneStatus.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'release',
        {
            title: 'Release',
            description:
                'Move issues included in a release tag or commit to doneStatus. Finds merged PRs whose merge commits are ancestors of the given ref, extracts linked issues, and moves open ones to Done.',
            inputSchema: {
                ref: z.string().describe('Tag name or commit SHA to release'),
                limit: z
                    .number()
                    .optional()
                    .describe('Number of merged PRs to check (default: 200)'),
                dryRun: z
                    .boolean()
                    .optional()
                    .describe('Show what would be moved without making changes'),
            },
        },
        async ({ ref, limit, dryRun }) => {
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
                // Verify ref exists
                try {
                    execSync(`git rev-parse --verify ${ref}`, { stdio: 'ignore' });
                } catch {
                    return {
                        content: [{ type: 'text' as const, text: `Error: Ref "${ref}" not found.` }],
                        isError: true,
                    };
                }

                const doneStatus = getConfigValue('doneStatus', 'Done');
                const checkLimit = limit || 200;

                // Get merged PRs with merge commit SHAs
                const stdout = execSync(
                    `gh pr list --state merged --json number,title,headRefName,body,url,mergeCommit --limit ${checkLimit}`,
                    { encoding: 'utf-8' }
                );
                const mergedPrs: MergedPr[] = JSON.parse(stdout);

                if (mergedPrs.length === 0) {
                    return {
                        content: [{ type: 'text' as const, text: 'No merged PRs found.' }],
                    };
                }

                // Filter to PRs whose merge commits are ancestors of the ref
                const includedPrs = mergedPrs.filter(
                    pr => pr.mergeCommit?.oid && isAncestor(pr.mergeCommit.oid, ref)
                );

                if (includedPrs.length === 0) {
                    return {
                        content: [{ type: 'text' as const, text: `No merged PRs found in the commit tree of ${ref}.` }],
                    };
                }

                // Collect linked issue numbers
                const issueSet = new Map<number, string>();
                for (const pr of includedPrs) {
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
                        content: [{ type: 'text' as const, text: 'No linked issues found in included PRs.' }],
                    };
                }

                const lines: string[] = [];
                let moved = 0;
                let skipped = 0;

                for (const [issueNumber, prRef] of issueSet) {
                    const item = await context.api.findItemByNumber(repo, issueNumber);
                    if (!item) continue;

                    if (item.status === doneStatus) {
                        skipped++;
                        continue;
                    }

                    if (dryRun) {
                        lines.push(`Would move #${issueNumber} "${item.title}" (${item.status} → ${doneStatus}) via ${prRef}`);
                        moved++;
                        continue;
                    }

                    const result = await context.api.moveIssueToStatus(repo, issueNumber, doneStatus);
                    if (result.success) {
                        lines.push(`Moved #${issueNumber} "${item.title}" → "${doneStatus}" (via ${prRef})`);
                        moved++;
                    } else {
                        lines.push(`Failed #${issueNumber}: ${result.error}`);
                    }
                }

                const summary = dryRun
                    ? `Dry run: ${moved} issue(s) would be moved to "${doneStatus}", ${skipped} already done`
                    : `Done: ${moved} moved to "${doneStatus}", ${skipped} already done`;

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

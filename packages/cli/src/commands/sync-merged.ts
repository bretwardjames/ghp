import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { api } from '../github-api.js';
import { detectRepository } from '../git-utils.js';
import { getConfig } from '../config.js';
import { extractIssueNumberFromBranch } from '@bretwardjames/ghp-core';
import { exit } from '../exit.js';

const execAsync = promisify(exec);

interface MergedPr {
    number: number;
    title: string;
    headRefName: string;
    body: string;
    url: string;
}

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

interface SyncMergedOptions {
    limit?: string;
    dryRun?: boolean;
}

export async function syncMergedCommand(options: SyncMergedOptions): Promise<void> {
    const repo = await detectRepository();
    if (!repo) {
        console.error(chalk.red('Error:'), 'Not in a git repository with a GitHub remote');
        exit(1);
    }

    const authenticated = await api.authenticate();
    if (!authenticated) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run', chalk.cyan('ghp auth'));
        exit(1);
    }

    const prMergedStatus = getConfig('prMergedStatus');
    const limit = parseInt(options.limit || '50', 10);

    console.log(chalk.dim(`Checking last ${limit} merged PRs for issues not in "${prMergedStatus}"...`));

    // Get recently merged PRs
    let mergedPrs: MergedPr[];
    try {
        const { stdout } = await execAsync(
            `gh pr list --state merged --json number,title,headRefName,body,url --limit ${limit}`
        );
        mergedPrs = JSON.parse(stdout);
    } catch (error: unknown) {
        const err = error as { stderr?: string };
        console.error(chalk.red('Error:'), 'Failed to list merged PRs:', err.stderr || 'unknown error');
        exit(1);
        return; // unreachable but satisfies TS
    }

    if (mergedPrs.length === 0) {
        console.log(chalk.yellow('No merged PRs found.'));
        return;
    }

    // Collect all issue numbers linked to merged PRs
    const issueSet = new Map<number, string>(); // issueNumber -> PR reference
    for (const pr of mergedPrs) {
        // From branch name
        const branchIssue = extractIssueNumberFromBranch(pr.headRefName);
        if (branchIssue) {
            issueSet.set(branchIssue, `PR #${pr.number}`);
        }

        // From PR body
        const bodyIssues = extractIssueNumbersFromBody(pr.body || '');
        for (const num of bodyIssues) {
            if (!issueSet.has(num)) {
                issueSet.set(num, `PR #${pr.number}`);
            }
        }
    }

    if (issueSet.size === 0) {
        console.log(chalk.yellow('No linked issues found in merged PRs.'));
        return;
    }

    console.log(chalk.dim(`Found ${issueSet.size} linked issue(s). Checking statuses...`));

    let moved = 0;
    let skipped = 0;
    let failed = 0;

    for (const [issueNumber, prRef] of issueSet) {
        const item = await api.findItemByNumber(repo, issueNumber);
        if (!item) {
            // Issue not in any project — skip silently
            continue;
        }

        if (item.status === prMergedStatus) {
            skipped++;
            continue;
        }

        if (options.dryRun) {
            console.log(chalk.cyan('→'), `#${issueNumber} "${item.title}" (${item.status} → ${prMergedStatus}) via ${prRef}`);
            moved++;
            continue;
        }

        const result = await api.moveIssueToStatus(repo, issueNumber, prMergedStatus);
        if (result.success) {
            console.log(chalk.green('✓'), `#${issueNumber} "${item.title}" → "${prMergedStatus}" (via ${prRef})`);
            moved++;
        } else {
            console.log(chalk.red('✗'), `#${issueNumber}: ${result.error}`);
            failed++;
        }
    }

    console.log();
    if (options.dryRun) {
        console.log(chalk.cyan('Dry run:'), `${moved} issue(s) would be moved, ${skipped} already in "${prMergedStatus}"`);
    } else {
        console.log(chalk.green('Done:'), `${moved} moved, ${skipped} already in "${prMergedStatus}"${failed > 0 ? `, ${failed} failed` : ''}`);
    }
}

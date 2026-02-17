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
    mergeCommit: { oid: string } | null;
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

/**
 * Check if a commit is an ancestor of a ref
 */
async function isAncestor(commit: string, ref: string): Promise<boolean> {
    try {
        await execAsync(`git merge-base --is-ancestor ${commit} ${ref}`);
        return true;
    } catch {
        return false;
    }
}

interface ReleaseOptions {
    limit?: string;
    dryRun?: boolean;
}

export async function releaseCommand(ref: string, options: ReleaseOptions): Promise<void> {
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

    // Verify the ref exists
    try {
        await execAsync(`git rev-parse --verify ${ref}`);
    } catch {
        console.error(chalk.red('Error:'), `Ref "${ref}" not found. Provide a valid tag or commit SHA.`);
        exit(1);
    }

    const doneStatus = getConfig('doneStatus');
    const limit = parseInt(options.limit || '200', 10);

    console.log(chalk.dim(`Checking merged PRs included in ${ref}...`));

    // Get merged PRs with merge commit SHAs
    let mergedPrs: MergedPr[];
    try {
        const { stdout } = await execAsync(
            `gh pr list --state merged --json number,title,headRefName,body,url,mergeCommit --limit ${limit}`
        );
        mergedPrs = JSON.parse(stdout);
    } catch (error: unknown) {
        const err = error as { stderr?: string };
        console.error(chalk.red('Error:'), 'Failed to list merged PRs:', err.stderr || 'unknown error');
        exit(1);
        return;
    }

    if (mergedPrs.length === 0) {
        console.log(chalk.yellow('No merged PRs found.'));
        return;
    }

    // Filter to PRs whose merge commits are ancestors of the given ref
    console.log(chalk.dim(`Checking ${mergedPrs.length} merged PRs against ${ref}...`));
    const includedPrs: MergedPr[] = [];

    for (const pr of mergedPrs) {
        if (!pr.mergeCommit?.oid) continue;
        if (await isAncestor(pr.mergeCommit.oid, ref)) {
            includedPrs.push(pr);
        }
    }

    if (includedPrs.length === 0) {
        console.log(chalk.yellow('No merged PRs found in the commit tree of'), ref);
        return;
    }

    console.log(chalk.dim(`Found ${includedPrs.length} PR(s) included in ${ref}.`));

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
        console.log(chalk.yellow('No linked issues found in included PRs.'));
        return;
    }

    console.log(chalk.dim(`Found ${issueSet.size} linked issue(s). Checking statuses...`));

    let moved = 0;
    let skipped = 0;
    let failed = 0;

    for (const [issueNumber, prRef] of issueSet) {
        const item = await api.findItemByNumber(repo, issueNumber);
        if (!item) continue;

        if (item.status === doneStatus) {
            skipped++;
            continue;
        }

        if (options.dryRun) {
            console.log(chalk.cyan('→'), `#${issueNumber} "${item.title}" (${item.status} → ${doneStatus}) via ${prRef}`);
            moved++;
            continue;
        }

        const result = await api.moveIssueToStatus(repo, issueNumber, doneStatus);
        if (result.success) {
            console.log(chalk.green('✓'), `#${issueNumber} "${item.title}" → "${doneStatus}" (via ${prRef})`);
            moved++;
        } else {
            console.log(chalk.red('✗'), `#${issueNumber}: ${result.error}`);
            failed++;
        }
    }

    console.log();
    if (options.dryRun) {
        console.log(chalk.cyan('Dry run:'), `${moved} issue(s) would be moved to "${doneStatus}", ${skipped} already done`);
    } else {
        console.log(chalk.green('Done:'), `${moved} moved to "${doneStatus}", ${skipped} already done${failed > 0 ? `, ${failed} failed` : ''}`);
    }
}

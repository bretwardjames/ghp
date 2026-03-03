import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { detectRepository } from '../git-utils.js';
import { api } from '../github-api.js';
import { exit } from '../exit.js';

const execAsync = promisify(exec);

interface ReviewOptions {
    json?: boolean;
}

// Raw shapes from gh CLI output

interface GhAuthor {
    login: string;
}

interface GhReview {
    author: GhAuthor;
    state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
    submittedAt: string;
}

interface GhStatusCheck {
    status: 'COMPLETED' | 'IN_PROGRESS' | 'QUEUED' | 'WAITING' | 'PENDING';
    conclusion: 'SUCCESS' | 'FAILURE' | 'NEUTRAL' | 'CANCELLED' | 'SKIPPED' | 'TIMED_OUT' | 'ACTION_REQUIRED' | null;
}

interface GhPr {
    number: number;
    title: string;
    author: GhAuthor;
    additions: number;
    deletions: number;
    changedFiles: number;
    reviews: GhReview[];
    statusCheckRollup: GhStatusCheck[] | null;
}

interface GhInlineComment {
    path: string;
    line: number | null;
    original_line: number | null;
    body: string;
    user: { login: string };
}

// Output shapes

interface PendingPr {
    number: number;
    title: string;
    author: string;
    files_changed: number;
    additions: number;
    deletions: number;
    review_comment_count: number;
    partially_reviewed: boolean;
}

interface ReviewDetail {
    number: number;
    title: string;
    author: string;
    files_changed: number;
    additions: number;
    deletions: number;
    existing_review_comments: Array<{ path: string; line: number | null; body: string }>;
    diff: string;
}

// Helpers

function getCiStatus(checks: GhStatusCheck[] | null): 'pass' | 'fail' | 'pending' {
    if (!checks || checks.length === 0) return 'pending';
    const completed = checks.filter(c => c.status === 'COMPLETED');
    if (completed.length === 0) return 'pending';
    const failed = completed.some(c =>
        c.conclusion === 'FAILURE' ||
        c.conclusion === 'CANCELLED' ||
        c.conclusion === 'TIMED_OUT' ||
        c.conclusion === 'ACTION_REQUIRED'
    );
    return failed ? 'fail' : 'pass';
}

function hasUserApproved(reviews: GhReview[], username: string): boolean {
    return reviews.some(r =>
        r.author.login === username &&
        (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED')
    );
}

function isPartiallyReviewed(reviews: GhReview[], username: string): boolean {
    return reviews.some(r => r.author.login === username && r.state === 'COMMENTED') &&
        !hasUserApproved(reviews, username);
}

function reviewCommentCount(reviews: GhReview[], username: string): number {
    return reviews.filter(r => r.author.login === username).length;
}

// Command handlers

async function reviewList(
    owner: string,
    repo: string,
    username: string,
    options: ReviewOptions
): Promise<void> {
    let prs: GhPr[];
    try {
        const { stdout } = await execAsync(
            `gh pr list --repo ${owner}/${repo} --state open --limit 100` +
            ` --json number,title,author,additions,deletions,changedFiles,reviews,statusCheckRollup`
        );
        prs = JSON.parse(stdout) as GhPr[];
    } catch (error) {
        console.error(chalk.red('Error:'), 'Failed to fetch open PRs:', error instanceof Error ? error.message : String(error));
        exit(1);
        return;
    }

    const pending: PendingPr[] = prs
        .filter(p => p.author.login !== username)
        .filter(p => getCiStatus(p.statusCheckRollup) === 'pass')
        .filter(p => !hasUserApproved(p.reviews, username))
        .map(p => ({
            number: p.number,
            title: p.title,
            author: p.author.login,
            files_changed: p.changedFiles,
            additions: p.additions,
            deletions: p.deletions,
            review_comment_count: reviewCommentCount(p.reviews, username),
            partially_reviewed: isPartiallyReviewed(p.reviews, username),
        }));

    if (options.json) {
        console.log(JSON.stringify({ prs: pending }, null, 2));
        return;
    }

    if (pending.length === 0) {
        console.log(chalk.dim('No PRs pending review.'));
        return;
    }

    console.log(chalk.bold(`\n${pending.length} PR(s) pending review:\n`));
    for (const p of pending) {
        const size = chalk.dim(`+${p.additions}/-${p.deletions} · ${p.files_changed} file(s)`);
        const partial = p.partially_reviewed ? chalk.yellow(' · partial review') : '';
        const comments = p.review_comment_count > 0 ? chalk.dim(` · ${p.review_comment_count} comment(s)`) : '';
        console.log(`  ${chalk.cyan(`#${p.number}`)}  ${p.title}`);
        console.log(`       ${chalk.dim('@' + p.author)}  ${size}${comments}${partial}`);
    }
    console.log();
}

async function reviewDetail(
    owner: string,
    repo: string,
    prNumber: number,
    username: string,
    options: ReviewOptions
): Promise<void> {
    // Fetch PR metadata
    let prData: { number: number; title: string; author: GhAuthor; additions: number; deletions: number; changedFiles: number; reviews: GhReview[] };
    try {
        const { stdout } = await execAsync(
            `gh pr view ${prNumber} --repo ${owner}/${repo}` +
            ` --json number,title,author,additions,deletions,changedFiles,reviews`
        );
        prData = JSON.parse(stdout);
    } catch (error) {
        console.error(chalk.red('Error:'), `Failed to fetch PR #${prNumber}:`, error instanceof Error ? error.message : String(error));
        exit(1);
        return;
    }

    // Fetch inline review comments (yours only — for dedup)
    let inlineComments: Array<{ path: string; line: number | null; body: string }> = [];
    try {
        const { stdout } = await execAsync(
            `gh api "/repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=100"`
        );
        const raw = JSON.parse(stdout) as GhInlineComment[];
        inlineComments = raw
            .filter(c => c.user.login === username)
            .map(c => ({
                path: c.path,
                line: c.line ?? c.original_line,
                body: c.body,
            }));
    } catch {
        // non-fatal — proceed without inline comments
    }

    // Fetch diff
    let diff = '';
    try {
        const { stdout } = await execAsync(
            `gh api "/repos/${owner}/${repo}/pulls/${prNumber}" -H "Accept: application/vnd.github.diff"`
        );
        diff = stdout;
    } catch {
        // non-fatal
    }

    const result: ReviewDetail = {
        number: prData.number,
        title: prData.title,
        author: prData.author.login,
        files_changed: prData.changedFiles,
        additions: prData.additions,
        deletions: prData.deletions,
        existing_review_comments: inlineComments,
        diff,
    };

    if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    // Human-readable
    console.log(chalk.bold(`\nPR #${result.number}: ${result.title}`));
    console.log(chalk.dim(`@${result.author} · +${result.additions}/-${result.deletions} across ${result.files_changed} file(s)`));

    if (inlineComments.length > 0) {
        console.log(chalk.yellow(`\nYour existing inline comments (${inlineComments.length}):`));
        for (const c of inlineComments) {
            const loc = chalk.dim(`${c.path}:${c.line ?? '?'}`);
            const preview = c.body.length > 100 ? c.body.substring(0, 100) + '…' : c.body;
            console.log(`  ${loc}  ${preview}`);
        }
    }

    if (diff) {
        console.log(chalk.bold('\nDiff:\n'));
        console.log(diff);
    }
}

export async function reviewCommand(pr: string | undefined, options: ReviewOptions): Promise<void> {
    const repo = await detectRepository();
    if (!repo) {
        console.error(chalk.red('Error:'), 'Not in a git repository with a GitHub remote');
        exit(1);
        return;
    }

    const authenticated = await api.authenticate();
    if (!authenticated) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run', chalk.cyan('ghp auth'));
        exit(1);
        return;
    }

    const username = api.username;
    if (!username) {
        console.error(chalk.red('Error:'), 'Could not determine current user');
        exit(1);
        return;
    }

    if (pr !== undefined) {
        const prNumber = parseInt(pr, 10);
        if (isNaN(prNumber)) {
            console.error(chalk.red('Error:'), 'PR must be a number');
            exit(1);
            return;
        }
        await reviewDetail(repo.owner, repo.name, prNumber, username, options);
    } else {
        await reviewList(repo.owner, repo.name, username, options);
    }
}

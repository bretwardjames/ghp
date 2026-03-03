/**
 * Worktree branch-swapping commands for ghp CLI.
 *
 * Enables "move-to" testing workflow:
 *   ghp wt move-to <issue>  — detach worktree HEAD, checkout branch in main repo
 *   ghp wt clean            — reverse the swap, restore both repos to original state
 */

import chalk from 'chalk';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { api } from '../github-api.js';
import { detectRepository, listWorktrees, getRepositoryRoot, getMainWorktreeRoot, getCurrentBranch, hasUncommittedChanges } from '../git-utils.js';
import { getBranchForIssue } from '../branch-linker.js';
import { exit } from '../exit.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// State file
// ---------------------------------------------------------------------------

interface SwapState {
    /** Branch main was on before the swap */
    mainBranch: string;
    /** Absolute path to the worktree */
    worktreePath: string;
    /** Branch the worktree was (and should return to) */
    worktreeBranch: string;
    /** ISO timestamp */
    swappedAt: string;
}

function getStateFilePath(repoRoot: string): string {
    return join(repoRoot, '.git', 'ghp-wt-state.json');
}

function readSwapState(repoRoot: string): SwapState | null {
    const path = getStateFilePath(repoRoot);
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as SwapState;
    } catch {
        return null;
    }
}

function writeSwapState(repoRoot: string, state: SwapState): void {
    writeFileSync(getStateFilePath(repoRoot), JSON.stringify(state, null, 2));
}

function clearSwapState(repoRoot: string): void {
    const path = getStateFilePath(repoRoot);
    if (existsSync(path)) unlinkSync(path);
}

// ---------------------------------------------------------------------------
// Git helpers (use execFile to avoid shell injection via branch names)
// ---------------------------------------------------------------------------

/** Detach HEAD in a specific worktree directory. */
async function detachWorktreeHead(worktreePath: string): Promise<void> {
    await execFileAsync('git', ['checkout', '--detach'], { cwd: worktreePath });
}

/** Re-attach a worktree to a branch (checkout the branch inside it). */
async function reattachWorktree(worktreePath: string, branch: string): Promise<void> {
    await execFileAsync('git', ['checkout', branch], { cwd: worktreePath });
}

/** Checkout a branch in the main repo. */
async function checkoutInMain(branch: string, repoRoot: string): Promise<void> {
    await execFileAsync('git', ['checkout', branch], { cwd: repoRoot });
}

/**
 * Determine how main's HEAD relates to the worktree branch.
 *
 * During a swap the worktree branch pointer has not moved since move-to, so
 * the only realistic outcomes are:
 *   'same'     — HEAD matches branch tip (no commits made while testing)
 *   'behind'   — branch advanced elsewhere (e.g. a push from the worktree)
 *   'diverged' — unrelated commits on both sides
 *
 * 'ahead' is theoretically possible only if the user committed directly on top
 * of the branch in main during the swap (unusual). We keep the check for
 * correctness but document it as the uncommon path.
 */
async function headRelationToBranch(
    branch: string,
    repoRoot: string
): Promise<'ahead' | 'same' | 'behind' | 'diverged'> {
    let branchSha: string;
    let headSha: string;
    try {
        branchSha = (await execFileAsync('git', ['rev-parse', branch],  { cwd: repoRoot })).stdout.trim();
        headSha   = (await execFileAsync('git', ['rev-parse', 'HEAD'],  { cwd: repoRoot })).stdout.trim();
    } catch {
        return 'diverged';
    }

    if (headSha === branchSha) return 'same';

    // Is branch an ancestor of HEAD? (HEAD is ahead of branch — user committed during swap)
    try {
        await execFileAsync('git', ['merge-base', '--is-ancestor', branch, 'HEAD'], { cwd: repoRoot });
        return 'ahead';
    } catch { /* not an ancestor */ }

    // Is HEAD an ancestor of branch? (branch moved forward elsewhere)
    try {
        await execFileAsync('git', ['merge-base', '--is-ancestor', 'HEAD', branch], { cwd: repoRoot });
        return 'behind';
    } catch { /* not an ancestor */ }

    return 'diverged';
}

// ---------------------------------------------------------------------------
// move-to
// ---------------------------------------------------------------------------

interface MoveToOptions {
    force?: boolean;
}

/**
 * Swap a worktree's branch into the main repo for live testing.
 *
 * Steps:
 *   1. Verify we're in the main worktree (not a linked one)
 *   2. Verify no swap already in progress
 *   3. Locate the worktree for the given issue
 *   4. Save current state (main branch, worktree path/branch)
 *   5. Detach worktree HEAD (so git allows main to check out the branch)
 *   6. Checkout the branch in main
 *   7. On failure at step 6: automatically re-attach worktree and abort
 */
export async function worktreeMoveToCommand(issue: string, options: MoveToOptions): Promise<void> {
    const issueNumber = parseInt(issue, 10);
    if (isNaN(issueNumber)) {
        console.error(chalk.red('Error:'), 'Issue must be a number');
        exit(1);
        return;
    }

    const repo = await detectRepository();
    if (!repo) {
        console.error(chalk.red('Error:'), 'Not in a git repository with a GitHub remote');
        exit(1);
        return;
    }

    // Resolve the main worktree root (not the cwd, which may be a linked worktree)
    const repoRoot = await getMainWorktreeRoot();
    if (!repoRoot) {
        console.error(chalk.red('Error:'), 'Could not determine repository root');
        exit(1);
        return;
    }

    // Guard: must be run from the main worktree, not a linked one
    const cwd = process.cwd();
    if (!cwd.startsWith(repoRoot) || cwd !== repoRoot) {
        // Allow subdirectories of main repo, but not linked worktrees
        const worktrees = await listWorktrees();
        const isLinked = worktrees.some(wt => !wt.isMain && cwd.startsWith(wt.path));
        if (isLinked) {
            console.error(chalk.red('Error:'), 'Run this command from the main repository, not from a linked worktree.');
            exit(1);
            return;
        }
    }

    // Guard: swap already in progress
    const existing = readSwapState(repoRoot);
    if (existing) {
        console.error(chalk.red('Error:'), 'A worktree swap is already in progress.');
        console.error(`  Branch: ${chalk.cyan(existing.worktreeBranch)}`);
        console.error(`  Since:  ${chalk.dim(existing.swappedAt)}`);
        console.error(`Run ${chalk.cyan('ghp wt clean')} to finish or undo the current swap.`);
        exit(1);
        return;
    }

    // Check for uncommitted changes in main
    if (!options.force && await hasUncommittedChanges()) {
        console.error(chalk.red('Error:'), 'Main repo has uncommitted changes.');
        console.error('Commit or stash them first, or use --force to proceed anyway.');
        exit(1);
        return;
    }

    const authenticated = await api.authenticate();
    if (!authenticated) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run', chalk.cyan('ghp auth'));
        exit(1);
        return;
    }

    // Find branch for the issue
    const branchName = await getBranchForIssue(repo, issueNumber);
    if (!branchName) {
        console.error(chalk.red('Error:'), `No branch linked to issue #${issueNumber}`);
        exit(1);
        return;
    }

    // Find the worktree for this branch
    const worktrees = await listWorktrees();
    const worktree = worktrees.find(wt => wt.branch === branchName && !wt.isMain);
    if (!worktree) {
        console.error(chalk.red('Error:'), `No worktree found for issue #${issueNumber} (branch: ${branchName})`);
        console.error(`Create one with ${chalk.cyan(`ghp start ${issueNumber} --parallel`)}`);
        exit(1);
        return;
    }

    const mainBranch = await getCurrentBranch();
    if (!mainBranch) {
        console.error(chalk.red('Error:'), 'Could not determine current branch');
        exit(1);
        return;
    }

    console.log(chalk.dim(`Swapping ${chalk.cyan(branchName)} into main repo...`));
    console.log(chalk.dim(`  Worktree: ${worktree.path}`));

    // Step 1: Detach worktree HEAD
    try {
        await detachWorktreeHead(worktree.path);
        console.log(chalk.dim(`  Detached HEAD in worktree`));
    } catch (error) {
        console.error(chalk.red('Error:'), 'Failed to detach worktree HEAD:', error instanceof Error ? error.message : String(error));
        exit(1);
        return;
    }

    // Step 2: Checkout the branch in main (with rollback on failure)
    try {
        await checkoutInMain(branchName, repoRoot);
    } catch (error) {
        console.error(chalk.red('Error:'), 'Failed to checkout branch in main repo:', error instanceof Error ? error.message : String(error));
        console.log(chalk.yellow('Rolling back:'), 're-attaching worktree...');
        try {
            await reattachWorktree(worktree.path, branchName);
            console.log(chalk.dim('  Worktree re-attached.'));
        } catch {
            console.error(chalk.yellow('Warning:'), 'Could not re-attach worktree automatically.');
            console.error(`  Run manually: ${chalk.cyan(`git -C "${worktree.path}" checkout "${branchName}"`)}`);
        }
        exit(1);
        return;
    }

    // Step 3: Save state
    writeSwapState(repoRoot, {
        mainBranch,
        worktreePath: worktree.path,
        worktreeBranch: branchName,
        swappedAt: new Date().toISOString(),
    });

    console.log(chalk.green('✓'), `Now on ${chalk.cyan(branchName)} in main repo`);
    console.log(chalk.dim(`  Main was on: ${mainBranch}`));
    console.log(chalk.dim(`  Worktree HEAD detached at: ${worktree.path}`));
    console.log();
    console.log(`When done testing, run ${chalk.cyan('ghp wt clean')} to restore both repos.`);
}

// ---------------------------------------------------------------------------
// clean
// ---------------------------------------------------------------------------

interface CleanOptions {
    force?: boolean;
}

/**
 * Reverse a worktree swap: restore main to its previous branch and re-attach
 * the worktree. If main accumulated new commits during testing, safely advances
 * the branch pointer before switching away.
 */
export async function worktreeCleanCommand(options: CleanOptions): Promise<void> {
    const repoRoot = await getMainWorktreeRoot();
    if (!repoRoot) {
        console.error(chalk.red('Error:'), 'Could not determine repository root');
        exit(1);
        return;
    }

    const state = readSwapState(repoRoot);
    if (!state) {
        console.error(chalk.red('Error:'), 'No worktree swap in progress.');
        console.error(`Use ${chalk.cyan('ghp wt move-to <issue>')} to start a swap.`);
        exit(1);
        return;
    }

    // Check for uncommitted changes before switching away
    if (!options.force && await hasUncommittedChanges()) {
        console.error(chalk.red('Error:'), 'Main repo has uncommitted changes.');
        console.error('Commit or stash them first, or use --force to restore anyway.');
        exit(1);
        return;
    }

    console.log(chalk.dim(`Cleaning up swap for ${chalk.cyan(state.worktreeBranch)}...`));

    // Check if main accumulated commits during testing
    const relation = await headRelationToBranch(state.worktreeBranch, repoRoot);

    if (relation === 'ahead') {
        // Uncommon: user committed directly on the branch in main during the swap.
        // Advance branch pointer so the worktree picks them up.
        console.log(chalk.dim(`  Main has new commits — advancing ${state.worktreeBranch} branch pointer`));
        try {
            await execFileAsync('git', ['branch', '-f', state.worktreeBranch, 'HEAD'], { cwd: repoRoot });
            console.log(chalk.green('✓'), `Advanced ${chalk.cyan(state.worktreeBranch)} to current HEAD`);
        } catch (error) {
            console.error(chalk.red('Error:'), 'Failed to advance branch pointer:', error instanceof Error ? error.message : String(error));
            if (!options.force) {
                exit(1);
                return;
            }
        }
    } else if (relation === 'diverged') {
        console.log(chalk.yellow('Warning:'), `${state.worktreeBranch} and current HEAD have diverged.`);
        console.log(chalk.dim('  The branch pointer will NOT be moved. Resolve the divergence manually.'));
        if (!options.force) {
            console.error(`Use --force to restore repos anyway (branch pointer will be left as-is).`);
            exit(1);
            return;
        }
    } else if (relation === 'same') {
        console.log(chalk.dim('  No new commits in main — branch pointer unchanged'));
    }

    // Restore main to its previous branch
    try {
        await checkoutInMain(state.mainBranch, repoRoot);
        console.log(chalk.dim(`  Restored main to ${state.mainBranch}`));
    } catch (error) {
        console.error(chalk.red('Error:'), 'Failed to restore main branch:', error instanceof Error ? error.message : String(error));
        exit(1);
        return;
    }

    // Re-attach worktree
    try {
        await reattachWorktree(state.worktreePath, state.worktreeBranch);
        console.log(chalk.dim(`  Re-attached worktree to ${state.worktreeBranch}`));
    } catch (error) {
        console.error(chalk.red('Error:'), 'Failed to re-attach worktree:', error instanceof Error ? error.message : String(error));
        console.error(`  Run manually: ${chalk.cyan(`git -C "${state.worktreePath}" checkout "${state.worktreeBranch}"`)}`);
        // Still clear state since main was restored
    }

    clearSwapState(repoRoot);

    console.log();
    console.log(chalk.green('✓'), 'Swap reversed');
    console.log(chalk.dim(`  Main: back on ${state.mainBranch}`));
    console.log(chalk.dim(`  Worktree: ${state.worktreePath} re-attached to ${state.worktreeBranch}`));
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

/**
 * Show the current swap state, if any.
 */
export async function worktreeSwapStatusCommand(): Promise<void> {
    const repoRoot = await getMainWorktreeRoot();
    if (!repoRoot) {
        console.error(chalk.red('Error:'), 'Could not determine repository root');
        exit(1);
        return;
    }

    const state = readSwapState(repoRoot);
    if (!state) {
        console.log(chalk.dim('No worktree swap in progress.'));
        return;
    }

    console.log(chalk.bold('Active worktree swap:'));
    console.log(`  Branch:    ${chalk.cyan(state.worktreeBranch)}`);
    console.log(`  Worktree:  ${chalk.dim(state.worktreePath)}`);
    console.log(`  Main was:  ${chalk.dim(state.mainBranch)}`);
    console.log(`  Since:     ${chalk.dim(new Date(state.swappedAt).toLocaleString())}`);
    console.log();
    console.log(`Run ${chalk.cyan('ghp wt clean')} to restore both repos.`);
}

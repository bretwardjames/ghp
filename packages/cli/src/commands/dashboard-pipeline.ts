/**
 * Pipeline dashboard — kanban view of all worktrees with pane-pull interaction.
 *
 * Layout (no pane attached):
 *
 *   GHP Dashboard                    [14:22:03]
 *   ─────────────────────────────────────────────────────
 *   NEEDS ATTENTION      READY           IN TESTING
 *   ⚠ [1] #271 auth      ✓ [i] #269      ⟳ #268
 *     S1 · 23m             ready 8m         [x] clean
 *
 *   WORKING
 *   ● #273 export  S1 · 1h 4m
 *   ● #275 dark    S3 · 22m
 *   ─────────────────────────────────────────────────────
 *   [1-9] pull  [i] next  [x] clean  [c] coord  [q] quit
 *
 * Layout (pane attached, split right):
 *   The dashboard narrows and the agent pane fills the right side.
 *   tmux handles the visual split; we just move the pane in/out.
 */

import chalk from 'chalk';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { getAgentSummaries, type AgentSummary } from '@bretwardjames/ghp-core';
import { getMainWorktreeRoot } from '../git-utils.js';
import { getAllPipelineEntries, getReadyWorktrees, type PipelineEntry } from '../pipeline-registry.js';
import { readSwapState } from './worktree-swap-state.js';
import { worktreeMoveToCommand, worktreeCleanCommand, worktreeNextCommand } from './worktree-swap.js';
import { registerCleanupHandler } from '../exit.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DashboardEntry {
    pipeline: PipelineEntry;
    agent?: AgentSummary;
    inMainRepo: boolean;
    /** 1-based index within the "needs attention" bucket, for keypress mapping */
    attentionIndex?: number;
    /** 1-based index within the "ready" bucket, for [i] override */
    readyIndex?: number;
}

interface AttachedPane {
    issueNumber: number;
    /** tmux global pane ID, e.g. %23 */
    paneId: string;
    /** Original window target the pane came from, e.g. ghp:ghp-271 */
    sourceWindow: string;
}

interface DashboardOptions {
    interval?: string;
}

// ---------------------------------------------------------------------------
// tmux pane helpers
// ---------------------------------------------------------------------------

async function getCurrentPaneId(): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync('tmux', ['display-message', '-p', '#{pane_id}']);
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

async function getCurrentWindowTarget(): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync('tmux', ['display-message', '-p', '#{session_name}:#{window_index}']);
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

/**
 * Pull a pane from a named window into the current window (horizontal split).
 * Returns the pane's global ID so we can send it back later.
 */
async function pullPane(sourceWindowName: string): Promise<{ paneId: string; sourceWindow: string } | null> {
    try {
        // Find the pane ID in the source window (first pane)
        const { stdout: paneIdOut } = await execFileAsync('tmux', [
            'display-message', '-t', sourceWindowName, '-p', '#{pane_id}',
        ]);
        const paneId = paneIdOut.trim();
        if (!paneId) return null;

        const sourceWindow = await getCurrentWindowTarget();
        if (!sourceWindow) return null;

        // Join the pane into the current window, horizontal split
        await execFileAsync('tmux', ['join-pane', '-h', '-s', paneId]);

        return { paneId, sourceWindow };
    } catch {
        return null;
    }
}

/**
 * Send a pane back to its original window.
 */
async function releasePane(attached: AttachedPane): Promise<void> {
    try {
        await execFileAsync('tmux', ['join-pane', '-t', attached.sourceWindow, '-s', attached.paneId]);
    } catch {
        // If the window is gone, just break the pane into its own window
        try {
            await execFileAsync('tmux', ['break-pane', '-t', attached.paneId, '-d']);
        } catch { /* best effort */ }
    }
}

// ---------------------------------------------------------------------------
// Coordinator pane detection
// ---------------------------------------------------------------------------

async function findCoordinatorPane(): Promise<string | null> {
    // Look for a window named ghp-root, ghp-coordinator, or ghp-main
    const candidates = ['ghp-root', 'ghp-coordinator', 'ghp-main'];
    for (const name of candidates) {
        try {
            const { stdout } = await execFileAsync('tmux', ['display-message', '-t', name, '-p', '#{window_name}']);
            if (stdout.trim()) return name;
        } catch { /* not found */ }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function formatAge(isoTimestamp?: string): string {
    if (!isoTimestamp) return '';
    const ms = Date.now() - new Date(isoTimestamp).getTime();
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
}

function issueLabel(entry: DashboardEntry): string {
    return `${chalk.cyan(`#${entry.pipeline.issueNumber}`)}  ${entry.pipeline.issueTitle.substring(0, 38)}`;
}

function stageLine(entry: DashboardEntry): string {
    const stage = chalk.dim(`S${entry.pipeline.stage}`);
    const uptime = entry.agent?.uptime ? chalk.dim(` · ${entry.agent.uptime}`) : '';
    const port = entry.agent?.port ? chalk.dim(` :${entry.agent.port}`) : '';
    return `${stage}${uptime}${port}`;
}

function renderDashboard(
    entries: DashboardEntry[],
    attached: AttachedPane | null,
    now: string
): void {
    process.stdout.write('\x1b[2J\x1b[H'); // clear

    const waiting = entries.filter(e => e.agent?.waitingForInput);
    const ready   = entries.filter(e => e.pipeline.stageStatus === 'ready' && !e.inMainRepo);
    const testing = entries.filter(e => e.inMainRepo);
    const working = entries.filter(e =>
        !e.agent?.waitingForInput &&
        e.pipeline.stageStatus === 'in_progress' &&
        !e.inMainRepo
    );

    // Assign attention indices
    waiting.forEach((e, i) => { e.attentionIndex = i + 1; });
    ready.forEach((e, i)   => { e.readyIndex = i + 1; });

    const attachedNote = attached ? chalk.yellow(` │ ATTACHED: #${attached.issueNumber}`) : '';
    console.log(chalk.bold('GHP Dashboard'), chalk.dim(`[${now}]`), attachedNote);
    console.log(chalk.dim('─'.repeat(70)));

    // Top row: Needs Attention | Ready | In Testing (side by side if space)
    const hasPriority = waiting.length > 0 || ready.length > 0 || testing.length > 0;

    if (waiting.length > 0) {
        console.log(chalk.yellow.bold('  NEEDS ATTENTION'));
        for (const e of waiting) {
            const key = chalk.yellow(`[${e.attentionIndex}]`);
            console.log(`  ${key} ${issueLabel(e)}  ${stageLine(e)}`);
            if (e.agent?.currentAction) {
                console.log(`       ${chalk.yellow(`└─ ⚠ ${e.agent.currentAction.substring(0, 55)}`)}`);
            }
        }
        console.log();
    }

    if (ready.length > 0) {
        console.log(chalk.green.bold('  READY FOR INTEGRATION'));
        for (const e of ready) {
            const age = formatAge(e.pipeline.readyAt);
            console.log(`  ${chalk.green('✓')}  ${issueLabel(e)}  ${chalk.dim(age)}`);
        }
        console.log(`  ${chalk.dim(`[i] swap next   [i <n>] pick specific`)}`);
        console.log();
    }

    if (testing.length > 0) {
        console.log(chalk.blue.bold('  IN TESTING (main repo)'));
        for (const e of testing) {
            console.log(`  ${chalk.blue('⟳')}  ${issueLabel(e)}`);
        }
        console.log(`  ${chalk.dim('[x] ghp wt clean')}`);
        console.log();
    }

    if (working.length > 0) {
        console.log(chalk.white.bold('  WORKING'));
        for (const e of working) {
            const sym = e.agent?.status === 'running' ? chalk.green('●') : chalk.dim('○');
            console.log(`  ${sym}  ${issueLabel(e)}  ${stageLine(e)}`);
            if (e.agent?.currentAction) {
                console.log(`       ${chalk.dim(`└─ ${e.agent.currentAction.substring(0, 55)}`)}`);
            }
        }
        console.log();
    }

    if (!hasPriority && working.length === 0) {
        console.log(chalk.dim('  No worktrees in pipeline.'));
        console.log(chalk.dim('  Start one: ghp start <issue> --parallel'));
        console.log();
    }

    console.log(chalk.dim('─'.repeat(70)));

    if (attached) {
        console.log(chalk.dim('[esc] send pane back  [c] coordinator  [q] quit'));
    } else {
        console.log(chalk.dim('[1-9] pull agent pane  [i] next integration  [x] clean  [c] coordinator  [q] quit'));
    }
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export async function pipelineDashboardCommand(options: DashboardOptions = {}): Promise<void> {
    const intervalSec = parseInt(options.interval || '2', 10);
    const intervalMs = intervalSec * 1000;

    if (!process.env.TMUX) {
        console.log(chalk.yellow('Warning:'), 'Not inside a tmux session — pane-pull features will be unavailable.');
        console.log(chalk.dim('Displaying read-only status. Ctrl+C to exit.'));
        console.log();
    }

    let attached: AttachedPane | null = null;
    let coordinatorWindow: string | null = null;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;
    let running = true;

    // Detect coordinator pane once at startup
    if (process.env.TMUX) {
        coordinatorWindow = await findCoordinatorPane();
    }

    // Build entries
    async function buildEntries(): Promise<DashboardEntry[]> {
        const repoRoot = await getMainWorktreeRoot();
        if (!repoRoot) return [];

        const pipeline = getAllPipelineEntries(repoRoot);
        const agents = getAgentSummaries();
        const swapState = readSwapState(repoRoot);

        const agentByIssue = new Map<number, AgentSummary>();
        for (const a of agents) agentByIssue.set(a.issueNumber, a);

        return pipeline.map(p => ({
            pipeline: p,
            agent: agentByIssue.get(p.issueNumber),
            inMainRepo: swapState?.worktreeBranch === p.branch,
        }));
    }

    async function refresh(): Promise<void> {
        const entries = await buildEntries();
        renderDashboard(entries, attached, new Date().toLocaleTimeString());
    }

    // Map attention-index → issue number for keypress handling
    async function getAttentionMap(): Promise<Map<number, DashboardEntry>> {
        const entries = await buildEntries();
        const map = new Map<number, DashboardEntry>();
        let idx = 1;
        for (const e of entries) {
            if (e.agent?.waitingForInput) {
                map.set(idx++, e);
            }
        }
        return map;
    }

    async function pullAgentPane(issueNumber: number): Promise<void> {
        if (attached) {
            console.log(chalk.yellow('A pane is already attached. Send it back first (esc).'));
            return;
        }
        const repoRoot = await getMainWorktreeRoot();
        if (!repoRoot) return;

        const entry = getAllPipelineEntries(repoRoot).find(e => e.issueNumber === issueNumber);
        if (!entry) return;

        // Derive the tmux window name (matches the pattern used at spawn time)
        const windowName = `ghp-${issueNumber}`;
        const result = await pullPane(windowName);
        if (!result) {
            console.log(chalk.red('Could not pull pane from'), windowName);
            return;
        }
        attached = { issueNumber, paneId: result.paneId, sourceWindow: result.sourceWindow };
        await refresh();
    }

    async function sendPaneBack(): Promise<void> {
        if (!attached) return;
        await releasePane(attached);
        attached = null;
        await refresh();
    }

    // ---------------------------------------------------------------------------
    // Keypress handler
    // ---------------------------------------------------------------------------

    async function handleKey(key: string): Promise<void> {
        // esc — send pane back
        if (key === '\x1b' || key === '\x1b[') {
            await sendPaneBack();
            return;
        }

        // q — quit
        if (key === 'q' || key === 'Q') {
            if (attached) await sendPaneBack();
            running = false;
            if (refreshTimer) clearInterval(refreshTimer);
            process.stdin.setRawMode(false);
            process.stdin.pause();
            console.log();
            console.log(chalk.dim('Dashboard closed.'));
            process.exit(0);
        }

        // c — pull coordinator pane
        if (key === 'c' || key === 'C') {
            if (attached) {
                await sendPaneBack();
                return;
            }
            if (!coordinatorWindow) {
                // Try to detect again
                coordinatorWindow = await findCoordinatorPane();
            }
            if (!coordinatorWindow) {
                // Re-render with a brief note
                process.stdout.write('\x1b[2J\x1b[H');
                console.log(chalk.yellow('No coordinator window found (ghp-root, ghp-coordinator, or ghp-main)'));
                setTimeout(() => refresh(), 1500);
                return;
            }
            const result = await pullPane(coordinatorWindow);
            if (result) {
                attached = { issueNumber: 0, paneId: result.paneId, sourceWindow: result.sourceWindow };
                await refresh();
            }
            return;
        }

        // i or n — swap next ready worktree (optionally with number)
        if (key === 'i' || key === 'I' || key === 'n' || key === 'N') {
            await worktreeNextCommand(undefined);
            await refresh();
            return;
        }

        // x — clean (reverse current swap)
        if (key === 'x' || key === 'X') {
            await worktreeCleanCommand({});
            await refresh();
            return;
        }

        // 1-9 — pull attention pane
        const digit = parseInt(key, 10);
        if (!isNaN(digit) && digit >= 1 && digit <= 9) {
            const attentionMap = await getAttentionMap();
            const entry = attentionMap.get(digit);
            if (entry) {
                await pullAgentPane(entry.pipeline.issueNumber);
            }
            return;
        }
    }

    // ---------------------------------------------------------------------------
    // Start
    // ---------------------------------------------------------------------------

    await refresh();
    refreshTimer = setInterval(() => {
        refresh().catch(() => {});
    }, intervalMs);

    // Register cleanup
    registerCleanupHandler(() => {
        if (refreshTimer) clearInterval(refreshTimer);
        if (attached) releasePane(attached).catch(() => {});
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
    });

    // Raw keypress input
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf-8');
        process.stdin.on('data', (key: string) => {
            // Ctrl+C
            if (key === '\u0003') {
                if (attached) releasePane(attached).catch(() => {});
                if (refreshTimer) clearInterval(refreshTimer);
                process.stdin.setRawMode(false);
                process.stdin.pause();
                console.log();
                process.exit(0);
            }
            handleKey(key).catch(() => {});
        });
    }

    // Keep alive
    await new Promise<void>(() => {});
}

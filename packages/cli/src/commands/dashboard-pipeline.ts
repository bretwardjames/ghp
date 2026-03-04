/**
 * Pipeline dashboard — kanban view of all worktrees with interactive controls.
 *
 * Detects tmux layout mode at startup:
 *   - pane mode:   agents are panes in the same window. [1-9] zooms the agent pane.
 *   - window mode: agents are in separate windows. [1-9] pulls pane into dashboard window.
 */

import chalk from 'chalk';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { getAgentSummaries, type AgentSummary } from '@bretwardjames/ghp-core';
import { getMainWorktreeRoot } from '../git-utils.js';
import { getConfig } from '../config.js';
import { getAllPipelineEntries, getReadyWorktrees, getIntegrationTriggerStage, type PipelineEntry } from '../pipeline-registry.js';
import { readSwapState } from './worktree-swap-state.js';
import { worktreeCleanCommand, worktreeNextCommand } from './worktree-swap.js';
import { registerCleanupHandler, resetExitState } from '../exit.js';

// Guard: when true, the dashboard cleanup handler is a no-op
let suppressCleanup = false;

/**
 * Run a command that might call exit() without killing the dashboard.
 * Temporarily overrides process.exit, suppresses cleanup, and resets exit state.
 */
async function safeExec(fn: () => Promise<void>): Promise<void> {
    const realExit = process.exit;
    process.exit = (() => {}) as never;
    suppressCleanup = true;
    try {
        await fn();
    } catch { /* swallow ExitPendingError */ } finally {
        // Wait a tick for any cleanup handlers to run (they'll be no-ops)
        await new Promise(resolve => setTimeout(resolve, 50));
        process.exit = realExit;
        suppressCleanup = false;
        resetExitState();
    }
}

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DashboardEntry {
    pipeline: PipelineEntry;
    agent?: AgentSummary;
    inMainRepo: boolean;
    attentionIndex?: number;
}

interface AttachedPane {
    issueNumber: number;
    paneId: string;
    sourceWindowName: string;
}

interface DashboardOptions {
    interval?: string;
}

type TmuxMode = 'pane' | 'window';

// ---------------------------------------------------------------------------
// tmux helpers — window mode (join-pane pull/release)
// ---------------------------------------------------------------------------

async function getCurrentWindowTarget(): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync('tmux', ['display-message', '-p', '#{session_name}:#{window_index}']);
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

async function pullPaneFromWindow(sourceWindowName: string, targetPaneId: string): Promise<{ paneId: string; sourceWindowName: string } | null> {
    try {
        const { stdout: paneIdOut } = await execFileAsync('tmux', [
            'display-message', '-t', sourceWindowName, '-p', '#{pane_id}',
        ]);
        const paneId = paneIdOut.trim();
        if (!paneId) return null;

        // Split the dashboard pane vertically: dashboard stays on top, agent gets bottom 50%
        await execFileAsync('tmux', ['join-pane', '-v', '-l', '50%', '-t', targetPaneId, '-s', paneId]);
        return { paneId, sourceWindowName };
    } catch {
        return null;
    }
}

async function releasePaneToWindow(attached: AttachedPane): Promise<void> {
    try {
        // break-pane -s = source pane to break out, -d = don't switch to it
        await execFileAsync('tmux', ['break-pane', '-s', attached.paneId, '-d']);
        // Restore the original window name (e.g., ghp-271)
        const { stdout } = await execFileAsync('tmux', [
            'display-message', '-t', attached.paneId, '-p', '#{window_id}',
        ]);
        const windowId = stdout.trim();
        if (windowId) {
            await execFileAsync('tmux', ['rename-window', '-t', windowId, attached.sourceWindowName]);
        }
    } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// tmux helpers — pane mode (zoom/select)
// ---------------------------------------------------------------------------

/** Find the pane ID that contains a process whose cwd matches the worktree path. */
async function findPaneForWorktree(worktreePath: string): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync('tmux', [
            'list-panes', '-F', '#{pane_id} #{pane_current_path}',
        ]);
        for (const line of stdout.trim().split('\n')) {
            const [paneId, panePath] = line.split(' ', 2);
            if (panePath && panePath.startsWith(worktreePath)) {
                return paneId;
            }
        }
    } catch { /* ignore */ }
    return null;
}

/** Select (focus) a pane. */
async function selectPane(paneId: string): Promise<void> {
    try {
        await execFileAsync('tmux', ['select-pane', '-t', paneId]);
    } catch { /* ignore */ }
}

/** Get the pane ID of the dashboard itself (this process). */
function getDashboardPaneId(): string | null {
    // TMUX_PANE is set by tmux for each pane's process — unlike display-message
    // which returns the *active* pane, this reliably identifies our own pane.
    return process.env.TMUX_PANE || null;
}

// ---------------------------------------------------------------------------
// Coordinator pane detection
// ---------------------------------------------------------------------------

async function findCoordinatorPane(): Promise<string | null> {
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
    const stage = chalk.dim(entry.pipeline.stage);
    const uptime = entry.agent?.uptime ? chalk.dim(` · ${entry.agent.uptime}`) : '';
    const port = entry.agent?.port ? chalk.dim(` :${entry.agent.port}`) : '';
    return `${stage}${uptime}${port}`;
}

function isAttached(entry: DashboardEntry, attached: AttachedPane | null): boolean {
    return attached !== null && attached.issueNumber === entry.pipeline.issueNumber;
}

function renderEntry(
    e: DashboardEntry,
    prefix: string,
    attached: AttachedPane | null,
    showAction?: boolean
): void {
    const active = isAttached(e, attached);
    const label = active
        ? chalk.bgCyan.black(` #${e.pipeline.issueNumber} `) + '  ' + chalk.bold(e.pipeline.issueTitle.substring(0, 35))
        : issueLabel(e);
    const marker = active ? chalk.cyan('►') : ' ';
    console.log(`  ${marker}${prefix} ${label}  ${stageLine(e)}`);
    if (showAction && e.agent?.currentAction) {
        console.log(`          ${chalk.dim(`└─ ${e.agent.currentAction.substring(0, 55)}`)}`);
    }
}

function renderDashboard(
    entries: DashboardEntry[],
    tmuxMode: TmuxMode,
    attached: AttachedPane | null,
    now: string
): void {
    process.stdout.write('\x1b[2J\x1b[H'); // clear

    const triggerStage = getIntegrationTriggerStage();
    const waiting = entries.filter(e => e.agent?.waitingForInput);
    const ready   = entries.filter(e => e.pipeline.stage === triggerStage && !e.inMainRepo);
    const testing = entries.filter(e => e.inMainRepo);
    const working = entries.filter(e =>
        !e.agent?.waitingForInput &&
        e.pipeline.stage !== triggerStage &&
        !e.inMainRepo
    );

    // Number all entries for keypress selection (attention first, then working)
    const numbered = [...waiting, ...working];
    numbered.forEach((e, i) => { e.attentionIndex = i + 1; });

    const attachedLabel = attached
        ? chalk.bgCyan.black(` VIEWING: #${attached.issueNumber} `)
        : '';

    console.log(chalk.bold('GHP Pipeline'), chalk.dim(`[${now}]`), attachedLabel);
    console.log(chalk.dim('─'.repeat(70)));

    if (waiting.length > 0) {
        console.log(chalk.yellow.bold('  NEEDS ATTENTION'));
        for (const e of waiting) {
            const key = chalk.yellow(`[${e.attentionIndex}]`);
            renderEntry(e, key, attached, true);
        }
        console.log();
    }

    if (ready.length > 0) {
        console.log(chalk.green.bold('  READY FOR INTEGRATION'));
        for (const e of ready) {
            const age = formatAge(e.pipeline.stageEnteredAt);
            const active = isAttached(e, attached);
            const marker = active ? chalk.cyan('►') : ' ';
            const label = active
                ? chalk.bgCyan.black(` #${e.pipeline.issueNumber} `) + '  ' + chalk.bold(e.pipeline.issueTitle.substring(0, 35))
                : issueLabel(e);
            console.log(`  ${marker}${chalk.green('✓')}  ${label}  ${chalk.dim(age)}`);
        }
        console.log();
    }

    if (testing.length > 0) {
        console.log(chalk.blue.bold('  IN TESTING (main repo)'));
        for (const e of testing) {
            const active = isAttached(e, attached);
            const marker = active ? chalk.cyan('►') : ' ';
            const label = active
                ? chalk.bgCyan.black(` #${e.pipeline.issueNumber} `) + '  ' + chalk.bold(e.pipeline.issueTitle.substring(0, 35))
                : issueLabel(e);
            console.log(`  ${marker}${chalk.blue('⟳')}  ${label}`);
        }
        console.log();
    }

    if (working.length > 0) {
        console.log(chalk.white.bold('  WORKING'));
        for (const e of working) {
            const sym = e.agent?.status === 'running' ? chalk.green('●') : chalk.dim('○');
            const key = e.attentionIndex ? chalk.dim(`[${e.attentionIndex}]`) : '   ';
            renderEntry(e, `${key} ${sym}`, attached, true);
        }
        console.log();
    }

    if (entries.length === 0) {
        console.log(chalk.dim('  No worktrees in pipeline.'));
        console.log(chalk.dim('  ghp start <issue> --parallel'));
        console.log();
    }

    console.log(chalk.dim('─'.repeat(70)));

    if (tmuxMode === 'pane') {
        console.log(chalk.dim('[1-9] focus agent  [i] next integration  [x] clean  [q] quit'));
    } else {
        if (attached) {
            console.log(chalk.dim('[1-9] swap  [esc] send back  [c] coordinator  [q] quit'));
        } else {
            console.log(chalk.dim('[1-9] pull pane  [i] next integration  [x] clean  [c] coordinator  [q] quit'));
        }
    }
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export async function pipelineDashboardCommand(options: DashboardOptions = {}): Promise<void> {
    const intervalSec = parseInt(options.interval || '2', 10);
    const intervalMs = intervalSec * 1000;

    // Detect tmux mode from config
    const parallelConfig = getConfig('parallelWork') as any;
    const tmuxMode: TmuxMode = parallelConfig?.tmux?.mode ?? 'window';

    if (!process.env.TMUX) {
        console.log(chalk.yellow('Warning:'), 'Not inside tmux — interactive features disabled.');
        console.log(chalk.dim('Showing read-only status. Ctrl+C to exit.'));
        console.log();
    }

    let attached: AttachedPane | null = null;
    // zoomedIssue removed — pane mode uses select-pane (focus) instead of zoom
    let dashboardPaneId: string | null = null;
    let coordinatorWindow: string | null = null;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;

    if (process.env.TMUX) {
        dashboardPaneId = getDashboardPaneId();
        if (tmuxMode === 'window') {
            coordinatorWindow = await findCoordinatorPane();
        }
    }

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
        renderDashboard(entries, tmuxMode, attached, new Date().toLocaleTimeString());
    }

    function getNumberedEntry(entries: DashboardEntry[], digit: number): DashboardEntry | undefined {
        const triggerStage = getIntegrationTriggerStage();
        const waiting = entries.filter(e => e.agent?.waitingForInput);
        const working = entries.filter(e =>
            !e.agent?.waitingForInput &&
            e.pipeline.stage !== triggerStage &&
            !e.inMainRepo
        );
        const numbered = [...waiting, ...working];
        return numbered[digit - 1];
    }

    // ---------------------------------------------------------------------------
    // Pane mode: select (focus) agent pane
    // ---------------------------------------------------------------------------

    async function focusAgent(issueNumber: number): Promise<void> {
        const repoRoot = await getMainWorktreeRoot();
        if (!repoRoot) return;

        const entry = getAllPipelineEntries(repoRoot).find(e => e.issueNumber === issueNumber);
        if (!entry) return;

        const paneId = await findPaneForWorktree(entry.worktreePath);
        if (paneId) {
            await selectPane(paneId);
        }
    }

    // ---------------------------------------------------------------------------
    // Window mode: pull/release
    // ---------------------------------------------------------------------------

    async function pullAgentPane(issueNumber: number): Promise<void> {
        // Hot-swap: release current pane before pulling the new one
        if (attached) {
            if (attached.issueNumber === issueNumber) return; // already showing this one
            await sendPaneBack();
        }

        const windowName = `ghp-${issueNumber}`;
        if (!dashboardPaneId) return;
        const result = await pullPaneFromWindow(windowName, dashboardPaneId);
        if (!result) return;

        // Set pane border title so it's visually clear which agent is shown
        try {
            await execFileAsync('tmux', ['select-pane', '-t', result.paneId, '-T', `Agent #${issueNumber}`]);
        } catch { /* best effort */ }

        attached = { issueNumber, paneId: result.paneId, sourceWindowName: result.sourceWindowName };
        await refresh();
    }

    async function sendPaneBack(): Promise<void> {
        if (!attached) return;
        await releasePaneToWindow(attached);
        attached = null;
        await refresh();
    }

    // ---------------------------------------------------------------------------
    // Keypress handler
    // ---------------------------------------------------------------------------

    async function handleKey(key: string): Promise<void> {
        // esc — send pane back (window mode) or refocus dashboard (pane mode)
        if (key === '\x1b') {
            if (tmuxMode === 'pane' && dashboardPaneId) {
                await selectPane(dashboardPaneId);
            } else if (tmuxMode === 'window' && attached) {
                await sendPaneBack();
            }
            return;
        }

        // q — quit
        if (key === 'q' || key === 'Q') {
            if (attached) await sendPaneBack();
            if (refreshTimer) clearInterval(refreshTimer);
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(false);
                process.stdin.pause();
            }
            console.log();
            process.exit(0);
        }

        // c — coordinator (window mode only)
        if ((key === 'c' || key === 'C') && tmuxMode === 'window') {
            if (attached) {
                await sendPaneBack();
                return;
            }
            if (!coordinatorWindow) coordinatorWindow = await findCoordinatorPane();
            if (!coordinatorWindow) {
                process.stdout.write('\x1b[2J\x1b[H');
                console.log(chalk.yellow('No coordinator window found'));
                setTimeout(() => refresh(), 1500);
                return;
            }
            if (!dashboardPaneId) return;
            const result = await pullPaneFromWindow(coordinatorWindow, dashboardPaneId);
            if (result) {
                attached = { issueNumber: 0, paneId: result.paneId, sourceWindowName: result.sourceWindowName };
                await refresh();
            }
            return;
        }

        // i or n — swap next ready worktree
        if (key === 'i' || key === 'I' || key === 'n' || key === 'N') {
            await safeExec(() => worktreeNextCommand(undefined));
            await refresh();
            return;
        }

        // x — clean
        if (key === 'x' || key === 'X') {
            await safeExec(() => worktreeCleanCommand({}));
            await refresh();
            return;
        }

        // 1-9 — zoom (pane mode) or pull (window mode)
        const digit = parseInt(key, 10);
        if (!isNaN(digit) && digit >= 1 && digit <= 9) {
            const entries = await buildEntries();
            const entry = getNumberedEntry(entries, digit);
            if (!entry) return;

            if (tmuxMode === 'pane') {
                await focusAgent(entry.pipeline.issueNumber);
            } else {
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

    registerCleanupHandler(() => {
        if (suppressCleanup) return;
        if (refreshTimer) clearInterval(refreshTimer);
        if (attached) releasePaneToWindow(attached).catch(() => {});
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
    });

    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf-8');
        process.stdin.on('data', (key: string) => {
            if (key === '\u0003') {
                if (attached) releasePaneToWindow(attached).catch(() => {});
                if (refreshTimer) clearInterval(refreshTimer);
                process.stdin.setRawMode(false);
                process.stdin.pause();
                console.log();
                process.exit(0);
            }
            handleKey(key).catch(() => {});
        });
    }

    await new Promise<void>(() => {});
}

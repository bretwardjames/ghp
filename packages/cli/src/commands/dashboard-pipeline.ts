/**
 * Pipeline dashboard — kanban view of all worktrees with interactive controls.
 *
 * Detects tmux layout mode at startup:
 *   - pane mode:   agents are panes in the same window. [1-9] zooms the agent pane.
 *   - window mode: agents are in separate windows. [1-9] pulls pane into dashboard window.
 */

import chalk from 'chalk';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { getAgentSummaries, type AgentSummary } from '@bretwardjames/ghp-core';
import { getMainWorktreeRoot } from '../git-utils.js';
import { getConfig, getParallelWorkConfig } from '../config.js';
import { resolveHookScript, runUserHookScript } from './pipeline-commands.js';
import { getAllPipelineEntries, getReadyWorktrees, getIntegrationTriggerStage, getPipelineStages, getStageEmoji, type PipelineEntry } from '../pipeline-registry.js';
import { readSwapState } from './worktree-swap-state.js';
import { worktreeCleanCommand, worktreeNextCommand } from './worktree-swap.js';
import { registerCleanupHandler, resetExitState } from '../exit.js';
import { adminWindowName, agentSessionName, getTmuxPrefix, tmuxSessionExists } from '../terminal-utils.js';

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

interface ViewportState {
    paneId: string;
    attachedIssue: number | null;
}

interface DashboardOptions {
    interval?: string;
}

type TmuxMode = 'pane' | 'window' | 'session';

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

/** Find the pane ID that contains a process whose cwd matches the worktree path (current window only). */
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

/** Find pane + window info for a worktree path across all tmux windows. */
async function findAgentByWorktreePath(worktreePath: string): Promise<{ paneId: string; windowName: string } | null> {
    try {
        const sep = '\t';
        const { stdout } = await execFileAsync('tmux', [
            'list-panes', '-a', '-F', `#{pane_id}${sep}#{window_name}${sep}#{pane_current_path}`,
        ]);
        for (const line of stdout.trim().split('\n')) {
            const [paneId, windowName, panePath] = line.split(sep);
            if (panePath && panePath.startsWith(worktreePath)) {
                return { paneId, windowName };
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

// ---------------------------------------------------------------------------
// tmux helpers — session mode (viewport with nested attach)
// ---------------------------------------------------------------------------

/** Create the viewport pane next to the dashboard. Returns the pane ID. */
async function createViewportPane(dashPaneId: string): Promise<string | null> {
    const { dashboard: dbConfig } = getParallelWorkConfig();
    const dirFlag = dbConfig.focusedAgent.direction === 'horizontal' ? '-h' : '-v';
    const size = dbConfig.focusedAgent.size;

    try {
        const { stdout } = await execFileAsync('tmux', [
            'split-window', dirFlag, '-l', size, '-t', dashPaneId, '-d',
            '-P', '-F', '#{pane_id}',
            'echo "Press [1-9] to view an agent"; read',
        ]);
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

/** Attach the viewport pane to an agent session via respawn-pane. */
async function attachViewportToSession(viewportPaneId: string, sessionName: string): Promise<void> {
    try {
        // TMUX="" prevents nested-tmux errors; the respawn replaces the viewport process.
        // The = prefix forces exact session name matching (prevents ghp-agent-8 matching ghp-agent-86).
        // Session names are validated to [a-zA-Z0-9_-]+ via prefix validation + integer issue numbers.
        const escaped = sessionName.replace(/'/g, "'\\''");
        await execFileAsync('tmux', [
            'respawn-pane', '-k', '-t', viewportPaneId,
            `TMUX="" tmux attach-session -t '=${escaped}'`,
        ]);
    } catch { /* best effort */ }
}

/** Detach the viewport pane (show placeholder). */
async function detachViewport(viewportPaneId: string): Promise<void> {
    try {
        await execFileAsync('tmux', [
            'respawn-pane', '-k', '-t', viewportPaneId,
            'echo "Press [1-9] to view an agent"; read',
        ]);
    } catch { /* best effort */ }
}

/** Kill the viewport pane. */
async function killViewportPane(viewportPaneId: string): Promise<void> {
    try {
        await execFileAsync('tmux', ['kill-pane', '-t', viewportPaneId]);
    } catch { /* best effort */ }
}

/** Get the pane ID of the dashboard itself (this process). */
function getDashboardPaneId(): string | null {
    // TMUX_PANE is set by tmux for each pane's process — unlike display-message
    // which returns the *active* pane, this reliably identifies our own pane.
    return process.env.TMUX_PANE || null;
}

// ---------------------------------------------------------------------------
// Hook: dashboard-opened
// ---------------------------------------------------------------------------

async function fireDashboardOpenedHook(paneId: string, mode?: string | null): Promise<void> {
    const repoRoot = await getMainWorktreeRoot();
    if (!repoRoot) return;

    const scriptPath = resolveHookScript(repoRoot, 'dashboard-opened', mode);
    if (!scriptPath) return;

    try {
        const child = spawn(scriptPath, [], {
            cwd: repoRoot,
            stdio: ['pipe', 'ignore', 'ignore'],
            detached: true,
        });
        child.stdin.write(JSON.stringify({ pane_id: paneId, window_name: adminWindowName() }));
        child.stdin.end();
        child.unref();
    } catch { /* silent */ }
}

// ---------------------------------------------------------------------------
// Coordinator pane detection
// ---------------------------------------------------------------------------

async function findCoordinatorPane(): Promise<string | null> {
    const prefix = getTmuxPrefix();
    const candidates = [`${prefix}-root`, `${prefix}-coordinator`, `${prefix}-main`];
    for (const name of candidates) {
        try {
            const { stdout } = await execFileAsync('tmux', ['display-message', '-t', name, '-p', '#{window_name}']);
            if (stdout.trim()) return name;
        } catch { /* not found */ }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async function isMainRepoDirty(repoRoot: string): Promise<boolean> {
    try {
        const { stdout } = await execFileAsync('git', ['-C', repoRoot, 'status', '--porcelain']);
        return stdout.trim().length > 0;
    } catch {
        return false;
    }
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
    const emoji = getStageEmoji(entry.pipeline.stage);
    const prefix = emoji ? `${emoji} ` : '';
    const stage = chalk.dim(`${prefix}${entry.pipeline.stage}`);
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
    now: string,
    mainDirty: boolean,
    hookMode?: string | null,
    hookModes?: string[],
): void {
    process.stdout.write('\x1b[2J\x1b[H'); // clear

    const triggerStage = getIntegrationTriggerStage();
    const stages = getPipelineStages();
    const hasTriggerStage = stages.includes(triggerStage);

    const waiting = entries.filter(e => e.agent?.waitingForInput || e.pipeline.stage === 'needs_attention');
    const ready   = hasTriggerStage ? entries.filter(e => e.pipeline.stage === triggerStage && !e.inMainRepo) : [];
    const testing = entries.filter(e => e.inMainRepo);
    const stopped = entries.filter(e =>
        e.pipeline.stage === 'stopped' &&
        !e.agent?.waitingForInput &&
        !e.inMainRepo
    );
    const working = entries.filter(e =>
        !e.agent?.waitingForInput &&
        e.pipeline.stage !== 'needs_attention' &&
        e.pipeline.stage !== 'stopped' &&
        (!hasTriggerStage || e.pipeline.stage !== triggerStage) &&
        !e.inMainRepo
    );

    // Number all entries for keypress selection (attention first, then stopped, then working)
    const numbered = [...waiting, ...stopped, ...working];
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

    if (stopped.length > 0) {
        console.log(chalk.dim.bold('  STOPPED'));
        for (const e of stopped) {
            const key = e.attentionIndex ? chalk.dim(`[${e.attentionIndex}]`) : '   ';
            renderEntry(e, `${key} ${chalk.dim('⏸')}`, attached, false);
        }
        console.log();
    }

    if (ready.length > 0) {
        const blocked = mainDirty ? chalk.red.bold('  BLOCKED') + chalk.red(' — main repo has uncommitted changes') : '';
        console.log(chalk.green.bold('  READY FOR INTEGRATION') + blocked);
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

    const modeLabel = (hookModes && hookModes.length > 0)
        ? `  [m] mode: ${hookMode ? chalk.cyan(hookMode) : chalk.dim('default')}`
        : '';

    if (tmuxMode === 'pane') {
        console.log(chalk.dim(`[1-9] focus agent${modeLabel}  [i] next integration  [x] clean  [q] quit`));
    } else if (tmuxMode === 'session') {
        if (attached) {
            console.log(chalk.dim(`[1-9] swap  [esc] detach${modeLabel}  [i] next integration  [x] clean  [q] quit`));
        } else {
            console.log(chalk.dim(`[1-9] attach session${modeLabel}  [i] next integration  [x] clean  [q] quit`));
        }
    } else {
        if (attached) {
            console.log(chalk.dim(`[1-9] swap  [esc] send back${modeLabel}  [c] coordinator  [q] quit`));
        } else {
            console.log(chalk.dim(`[1-9] pull pane${modeLabel}  [i] next integration  [x] clean  [c] coordinator  [q] quit`));
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

    // Session mode viewport state
    let viewport: ViewportState | null = null;

    // Hook mode state — runtime only, initialized from config
    const pipelineConfig = getConfig('pipeline') as any;
    const hookModes: string[] = pipelineConfig?.hookModes ?? [];
    let currentHookMode: string | null = pipelineConfig?.defaultHookMode ?? null;
    // Validate that defaultHookMode is in the hookModes list
    if (currentHookMode && hookModes.length > 0 && !hookModes.includes(currentHookMode)) {
        currentHookMode = hookModes[0];
    }
    if (hookModes.length === 0) currentHookMode = null;

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
        // Session mode: validate attached session still exists
        if (tmuxMode === 'session' && viewport?.attachedIssue != null) {
            const sessionName = agentSessionName(viewport.attachedIssue);
            const exists = await tmuxSessionExists(sessionName);
            if (!exists) {
                // Fire agent-unfocused hook before clearing state (fire-and-forget)
                const repoRoot = await getMainWorktreeRoot();
                if (repoRoot) {
                    const entry = getAllPipelineEntries(repoRoot).find(e => e.issueNumber === viewport!.attachedIssue);
                    if (entry) {
                        runUserHookScript('agent-unfocused', agentPayload(entry), entry.worktreePath, currentHookMode);
                    }
                }
                viewport.attachedIssue = null;
                attached = null;
                await detachViewport(viewport.paneId);
            }
        }

        const repoRoot = await getMainWorktreeRoot();
        const entries = await buildEntries();
        const dirty = repoRoot ? await isMainRepoDirty(repoRoot) : false;
        renderDashboard(entries, tmuxMode, attached, new Date().toLocaleTimeString(), dirty, currentHookMode, hookModes);
    }

    function getNumberedEntry(entries: DashboardEntry[], digit: number): DashboardEntry | undefined {
        const triggerStage = getIntegrationTriggerStage();
        const stages = getPipelineStages();
        const hasTriggerStage = stages.includes(triggerStage);

        const waiting = entries.filter(e => e.agent?.waitingForInput || e.pipeline.stage === 'needs_attention');
        const stopped = entries.filter(e =>
            e.pipeline.stage === 'stopped' &&
            !e.agent?.waitingForInput &&
            !e.inMainRepo
        );
        const working = entries.filter(e =>
            !e.agent?.waitingForInput &&
            e.pipeline.stage !== 'needs_attention' &&
            e.pipeline.stage !== 'stopped' &&
            (!hasTriggerStage || e.pipeline.stage !== triggerStage) &&
            !e.inMainRepo
        );
        const numbered = [...waiting, ...stopped, ...working];
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

    /** Build the JSON payload for a focused/unfocused hook. */
    function agentPayload(entry: PipelineEntry): string {
        return JSON.stringify({
            issueNumber: entry.issueNumber,
            worktreePath: entry.worktreePath,
            branch: entry.branch,
        });
    }

    /** Fire the agent-swapped hook, or fall back to sequential unfocus→focus. */
    async function fireSwapHook(oldEntry: PipelineEntry, newEntry: PipelineEntry): Promise<void> {
        const repoRoot = await getMainWorktreeRoot();
        if (!repoRoot) return;

        const swapScript = resolveHookScript(repoRoot, 'agent-swapped', currentHookMode);

        if (swapScript) {
            // Atomic swap hook
            const payload = JSON.stringify({
                old: { issueNumber: oldEntry.issueNumber, worktreePath: oldEntry.worktreePath, branch: oldEntry.branch },
                new: { issueNumber: newEntry.issueNumber, worktreePath: newEntry.worktreePath, branch: newEntry.branch },
            });
            try {
                const child = spawn(swapScript, [], {
                    cwd: newEntry.worktreePath,
                    stdio: ['pipe', 'ignore', 'ignore'],
                    detached: true,
                });
                child.stdin.write(payload);
                child.stdin.end();
                child.unref();
            } catch { /* silent */ }
        } else {
            // Fallback: sequential unfocus→focus (respecting hookModeSwapOrder)
            // Await the first to guarantee ordering; second is fire-and-forget
            const swapOrder = pipelineConfig?.hookModeSwapOrder ?? 'unfocus-first';
            if (swapOrder === 'focus-first') {
                await runUserHookScript('agent-focused', agentPayload(newEntry), newEntry.worktreePath, currentHookMode);
                runUserHookScript('agent-unfocused', agentPayload(oldEntry), oldEntry.worktreePath, currentHookMode);
            } else {
                await runUserHookScript('agent-unfocused', agentPayload(oldEntry), oldEntry.worktreePath, currentHookMode);
                runUserHookScript('agent-focused', agentPayload(newEntry), newEntry.worktreePath, currentHookMode);
            }
        }
    }

    async function pullAgentPane(issueNumber: number): Promise<void> {
        let previousEntry: PipelineEntry | null = null;

        // Hot-swap: if already viewing a different agent
        if (attached) {
            if (attached.issueNumber === issueNumber) return; // already showing this one

            // Look up the old entry before releasing
            if (attached.issueNumber > 0) {
                const repoRoot = await getMainWorktreeRoot();
                if (repoRoot) {
                    previousEntry = getAllPipelineEntries(repoRoot).find(e => e.issueNumber === attached!.issueNumber) ?? null;
                }
            }

            // Release the tmux pane
            await releasePaneToWindow(attached);
            attached = null;
        }

        if (!dashboardPaneId) return;

        // Look up worktree path from pipeline registry, then find the pane by cwd
        const repoRoot = await getMainWorktreeRoot();
        if (!repoRoot) return;
        const pipelineEntry = getAllPipelineEntries(repoRoot).find(e => e.issueNumber === issueNumber);
        if (!pipelineEntry) return;

        const agent = await findAgentByWorktreePath(pipelineEntry.worktreePath);
        if (!agent) return;

        // Read focused agent config for direction/size
        const { dashboard: dbConfig } = getParallelWorkConfig();
        const dirFlag = dbConfig.focusedAgent.direction === 'horizontal' ? '-h' : '-v';
        const size = dbConfig.focusedAgent.size;

        // Pull the pane into dashboard
        try {
            await execFileAsync('tmux', ['join-pane', dirFlag, '-l', size, '-t', dashboardPaneId, '-s', agent.paneId]);
        } catch { return; }

        // Set pane border title so it's visually clear which agent is shown
        try {
            await execFileAsync('tmux', ['select-pane', '-t', agent.paneId, '-T', `Agent #${issueNumber}`]);
        } catch { /* best effort */ }

        attached = { issueNumber, paneId: agent.paneId, sourceWindowName: agent.windowName };

        // Fire hooks
        if (previousEntry) {
            // Hot-swap: atomic agent-swapped or sequential fallback
            fireSwapHook(previousEntry, pipelineEntry);
        } else {
            // Fresh pull: agent-focused only
            runUserHookScript('agent-focused', agentPayload(pipelineEntry), pipelineEntry.worktreePath, currentHookMode);
        }

        await refresh();
    }

    async function sendPaneBack(): Promise<void> {
        if (!attached) return;

        // Fire agent-unfocused hook before releasing (fire-and-forget)
        if (attached.issueNumber > 0) {
            const repoRoot = await getMainWorktreeRoot();
            if (repoRoot) {
                const entry = getAllPipelineEntries(repoRoot).find(e => e.issueNumber === attached!.issueNumber);
                if (entry) {
                    runUserHookScript('agent-unfocused', agentPayload(entry), entry.worktreePath, currentHookMode);
                }
            }
        }

        await releasePaneToWindow(attached);
        attached = null;
        await refresh();
    }

    // ---------------------------------------------------------------------------
    // Session mode: attach/detach via viewport
    // ---------------------------------------------------------------------------

    async function attachSessionToViewport(issueNumber: number): Promise<void> {
        if (!viewport) return;
        if (viewport.attachedIssue === issueNumber) return; // already attached

        const sessionName = agentSessionName(issueNumber);
        const exists = await tmuxSessionExists(sessionName);
        if (!exists) return;

        let previousEntry: PipelineEntry | null = null;

        // Hot-swap: if already viewing a different agent
        if (viewport.attachedIssue != null) {
            const repoRoot = await getMainWorktreeRoot();
            if (repoRoot) {
                previousEntry = getAllPipelineEntries(repoRoot).find(e => e.issueNumber === viewport!.attachedIssue) ?? null;
            }
        }

        await attachViewportToSession(viewport.paneId, sessionName);
        viewport.attachedIssue = issueNumber;
        attached = { issueNumber, paneId: viewport.paneId, sourceWindowName: '' };

        // Set pane border title
        try {
            await execFileAsync('tmux', ['select-pane', '-t', viewport.paneId, '-T', `Agent #${issueNumber}`]);
        } catch { /* best effort */ }

        // Fire hooks
        const repoRoot = await getMainWorktreeRoot();
        if (repoRoot) {
            const newEntry = getAllPipelineEntries(repoRoot).find(e => e.issueNumber === issueNumber);
            if (newEntry) {
                if (previousEntry) {
                    fireSwapHook(previousEntry, newEntry);
                } else {
                    runUserHookScript('agent-focused', agentPayload(newEntry), newEntry.worktreePath, currentHookMode);
                }
            }
        }

        await refresh();
    }

    /** Fire agent-unfocused hook and kill the viewport pane. Fire-and-forget safe. */
    function cleanupViewport(): void {
        if (!viewport) return;
        if (viewport.attachedIssue != null) {
            getMainWorktreeRoot().then(repoRoot => {
                if (!repoRoot) return;
                const entry = getAllPipelineEntries(repoRoot).find(e => e.issueNumber === viewport!.attachedIssue);
                if (entry) runUserHookScript('agent-unfocused', agentPayload(entry), entry.worktreePath, currentHookMode);
            }).catch(() => {});
        }
        killViewportPane(viewport.paneId).catch(() => {});
    }

    async function detachSessionFromViewport(): Promise<void> {
        if (!viewport || viewport.attachedIssue == null) return;

        // Fire agent-unfocused hook
        const repoRoot = await getMainWorktreeRoot();
        if (repoRoot) {
            const entry = getAllPipelineEntries(repoRoot).find(e => e.issueNumber === viewport!.attachedIssue);
            if (entry) {
                runUserHookScript('agent-unfocused', agentPayload(entry), entry.worktreePath, currentHookMode);
            }
        }

        await detachViewport(viewport.paneId);
        viewport.attachedIssue = null;
        attached = null;
        await refresh();
    }

    // ---------------------------------------------------------------------------
    // Keypress handler
    // ---------------------------------------------------------------------------

    async function handleKey(key: string): Promise<void> {
        // esc — send pane back (window mode), detach (session mode), or refocus dashboard (pane mode)
        if (key === '\x1b') {
            if (tmuxMode === 'pane' && dashboardPaneId) {
                await selectPane(dashboardPaneId);
            } else if (tmuxMode === 'session') {
                await detachSessionFromViewport();
            } else if (tmuxMode === 'window' && attached) {
                await sendPaneBack();
            }
            return;
        }

        // q — quit
        if (key === 'q' || key === 'Q') {
            if (tmuxMode === 'session' && viewport) {
                cleanupViewport();
            } else if (attached) {
                await sendPaneBack();
            }
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

        // m — cycle hook modes (includes null/"default" as the last position)
        if (key === 'm' || key === 'M') {
            if (hookModes.length > 0) {
                const oldMode = currentHookMode;
                const currentIdx = currentHookMode ? hookModes.indexOf(currentHookMode) : -1;
                const nextIdx = currentIdx + 1;
                // After the last named mode, wrap to null (default/unsuffixed hooks)
                currentHookMode = nextIdx < hookModes.length ? hookModes[nextIdx] : null;
                // Fire mode-switched hook (fire-and-forget, never mode-suffixed)
                const modePayload = JSON.stringify({ oldMode: oldMode ?? null, newMode: currentHookMode ?? null });
                const modeRoot = await getMainWorktreeRoot();
                if (modeRoot) {
                    runUserHookScript('mode-switched', modePayload, modeRoot, null);
                }
                await refresh();
            }
            return;
        }

        // x — clean
        if (key === 'x' || key === 'X') {
            await safeExec(() => worktreeCleanCommand({}));
            await refresh();
            return;
        }

        // 1-9 — focus (pane mode), pull (window mode), or attach (session mode)
        const digit = parseInt(key, 10);
        if (!isNaN(digit) && digit >= 1 && digit <= 9) {
            const entries = await buildEntries();
            const entry = getNumberedEntry(entries, digit);
            if (!entry) return;

            if (tmuxMode === 'pane') {
                await focusAgent(entry.pipeline.issueNumber);
            } else if (tmuxMode === 'session') {
                await attachSessionToViewport(entry.pipeline.issueNumber);
            } else {
                await pullAgentPane(entry.pipeline.issueNumber);
            }
            return;
        }
    }

    // ---------------------------------------------------------------------------
    // Start
    // ---------------------------------------------------------------------------

    // Session mode: create viewport pane at startup
    if (tmuxMode === 'session' && dashboardPaneId) {
        const vpPaneId = await createViewportPane(dashboardPaneId);
        if (vpPaneId) {
            viewport = { paneId: vpPaneId, attachedIssue: null };
        }
    }

    await refresh();

    // Fire dashboard-opened hook (fire-and-forget)
    if (dashboardPaneId) {
        fireDashboardOpenedHook(dashboardPaneId, currentHookMode);
    }

    refreshTimer = setInterval(() => {
        refresh().catch(() => {});
    }, intervalMs);

    registerCleanupHandler(() => {
        if (suppressCleanup) return;
        if (refreshTimer) clearInterval(refreshTimer);
        if (viewport) {
            cleanupViewport();
        } else if (attached) {
            releasePaneToWindow(attached).catch(() => {});
        }
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
    });

    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf-8');
        process.stdin.on('data', (key: string) => {
            if (key === '\u0003') {
                if (viewport) {
                    cleanupViewport();
                } else if (attached) {
                    releasePaneToWindow(attached).catch(() => {});
                }
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

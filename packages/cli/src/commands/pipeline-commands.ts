/**
 * Pipeline stage management commands.
 *
 * ghp pipeline advance [issue]        — advance to next stage
 * ghp pipeline set <stage> [issue]    — jump to specific stage
 * ghp pipeline stages                 — list configured stages
 * ghp pipeline agent-active           — set agent to working + fire user hooks (PostToolUse)
 * ghp pipeline agent-stopped          — set agent to stopped + fire user hooks (Stop)
 * ghp pipeline agent-focused <issue>  — fire user hooks (dashboard pull)
 * ghp pipeline agent-unfocused <issue>— fire user hooks (dashboard release)
 */

import chalk from 'chalk';
import { execFileSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { getMainWorktreeRoot } from '../git-utils.js';
import { getConfig } from '../config.js';
import {
    advanceWorktreeStage,
    setWorktreeStage,
    deregisterWorktree,
    getPipelineEntry,
    getPipelineStages,
    getIntegrationTriggerStage,
    getStageEmoji,
} from '../pipeline-registry.js';
import { exit } from '../exit.js';

function extractIssueFromBranch(branch: string): number | null {
    const match = branch.match(/\/(\d+)-/);
    return match ? parseInt(match[1], 10) : null;
}

async function resolveIssueNumber(issueArg?: string): Promise<number | null> {
    if (issueArg) {
        const num = parseInt(issueArg, 10);
        return isNaN(num) ? null : num;
    }
    // Auto-detect from current branch
    try {
        const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf-8' }).trim();
        return extractIssueFromBranch(branch);
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Read all of stdin as a string (with a safety timeout). */
async function readStdin(): Promise<string> {
    try {
        return await new Promise<string>((resolve, reject) => {
            const chunks: Buffer[] = [];
            process.stdin.on('data', (chunk) => chunks.push(chunk));
            process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
            process.stdin.on('error', reject);
            // Safety timeout — don't hang forever if stdin never closes
            setTimeout(() => resolve(Buffer.concat(chunks).toString('utf-8')), 2000);
        });
    } catch {
        return '';
    }
}

/**
 * Resolve a hook script path with mode-aware dot-suffix convention.
 *
 * When mode is set (and not 'default'):
 *   1. Try `.ghp/hooks/<hookName>.<mode>` (mode-specific)
 *   2. Fall back to `.ghp/hooks/<hookName>` (generic)
 *
 * When mode is unset or 'default', only the unsuffixed script is checked.
 * Returns the full path if found, or null.
 */
export function resolveHookScript(repoRoot: string, hookName: string, mode?: string | null): string | null {
    if (mode && mode !== 'default') {
        const modedPath = join(repoRoot, '.ghp', 'hooks', `${hookName}.${mode}`);
        if (existsSync(modedPath)) return modedPath;
    }
    const genericPath = join(repoRoot, '.ghp', 'hooks', hookName);
    if (existsSync(genericPath)) return genericPath;
    return null;
}

/**
 * Run a user hook script from `.ghp/hooks/<hookName>` if it exists.
 * Spawns fire-and-forget with stdinData piped to the script's stdin.
 * Silent on errors. Supports mode-aware dot-suffix resolution.
 */
export async function runUserHookScript(hookName: string, stdinData: string, cwd: string, mode?: string | null): Promise<void> {
    // Find the main worktree root (where .ghp/ lives)
    const repoRoot = await getMainWorktreeRoot();
    if (!repoRoot) return;

    const scriptPath = resolveHookScript(repoRoot, hookName, mode);
    if (!scriptPath) return;

    try {
        const child = spawn(scriptPath, [], {
            cwd,
            stdio: ['pipe', 'ignore', 'ignore'],
            detached: true,
        });
        child.stdin.write(stdinData);
        child.stdin.end();
        child.unref();
    } catch {
        // Silent — user scripts failing should never break the pipeline
    }
}

/**
 * Resolve repo root and issue number from a cwd (extracted from hook JSON).
 * Returns null if either cannot be determined.
 */
async function resolveFromCwd(cwd: string): Promise<{ repoRoot: string; issueNumber: number } | null> {
    const repoRoot = await getMainWorktreeRoot();
    if (!repoRoot) return null;

    let issueNumber: number | null = null;
    try {
        const branch = execFileSync('git', ['branch', '--show-current'], {
            encoding: 'utf-8',
            cwd,
            stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
        issueNumber = extractIssueFromBranch(branch);
    } catch {
        return null;
    }
    if (!issueNumber) return null;

    return { repoRoot, issueNumber };
}

// ---------------------------------------------------------------------------
// Existing commands (advance, set, remove, stages)
// ---------------------------------------------------------------------------

export async function pipelineAdvanceCommand(issueArg?: string): Promise<void> {
    const repoRoot = await getMainWorktreeRoot();
    if (!repoRoot) {
        console.error(chalk.red('Error:'), 'Could not determine repository root');
        exit(1);
        return;
    }

    const issueNumber = await resolveIssueNumber(issueArg);
    if (!issueNumber) {
        console.error(chalk.red('Error:'), 'Could not determine issue number. Pass it explicitly: ghp pipeline advance <issue>');
        exit(1);
        return;
    }

    const before = getPipelineEntry(repoRoot, issueNumber);
    if (!before) {
        console.error(chalk.red('Error:'), `Issue #${issueNumber} is not in the pipeline.`);
        exit(1);
        return;
    }

    const after = advanceWorktreeStage(repoRoot, issueNumber);
    if (!after || after.stage === before.stage) {
        console.log(chalk.yellow('Already at last stage:'), chalk.dim(before.stage));
        return;
    }

    console.log(chalk.green('✓'), `#${issueNumber}: ${chalk.dim(before.stage)} → ${chalk.cyan(after.stage)}`);
}

export async function pipelineSetCommand(stage: string, issueArg?: string): Promise<void> {
    const repoRoot = await getMainWorktreeRoot();
    if (!repoRoot) {
        console.error(chalk.red('Error:'), 'Could not determine repository root');
        exit(1);
        return;
    }

    const issueNumber = await resolveIssueNumber(issueArg);
    if (!issueNumber) {
        console.error(chalk.red('Error:'), 'Could not determine issue number. Pass it explicitly: ghp pipeline set <stage> <issue>');
        exit(1);
        return;
    }

    const stages = getPipelineStages();
    if (!stages.includes(stage) && stage !== 'needs_attention') {
        console.error(chalk.red('Error:'), `Unknown stage: ${stage}`);
        console.error('Available stages:', stages.join(', ') + ', needs_attention');
        exit(1);
        return;
    }

    const entry = setWorktreeStage(repoRoot, issueNumber, stage);
    if (!entry) {
        console.error(chalk.red('Error:'), `Issue #${issueNumber} is not in the pipeline.`);
        exit(1);
        return;
    }

    console.log(chalk.green('✓'), `#${issueNumber} → ${chalk.cyan(stage)}`);
}

export async function pipelineRemoveCommand(issueArg?: string): Promise<void> {
    const repoRoot = await getMainWorktreeRoot();
    if (!repoRoot) {
        console.error(chalk.red('Error:'), 'Could not determine repository root');
        exit(1);
        return;
    }

    const issueNumber = await resolveIssueNumber(issueArg);
    if (!issueNumber) {
        console.error(chalk.red('Error:'), 'Could not determine issue number. Pass it explicitly: ghp pipeline remove <issue>');
        exit(1);
        return;
    }

    const entry = getPipelineEntry(repoRoot, issueNumber);
    if (!entry) {
        console.error(chalk.red('Error:'), `Issue #${issueNumber} is not in the pipeline.`);
        exit(1);
        return;
    }

    deregisterWorktree(repoRoot, issueNumber);
    console.log(chalk.green('✓'), `Removed #${issueNumber} from pipeline`);
}

export async function pipelineStagesCommand(): Promise<void> {
    const stages = getPipelineStages();
    const triggerStage = getIntegrationTriggerStage();

    console.log(chalk.bold('Pipeline Stages'));
    console.log();
    for (let i = 0; i < stages.length; i++) {
        const name = stages[i];
        const emoji = getStageEmoji(name);
        const prefix = emoji ? `${emoji} ` : '  ';
        const marker = name === triggerStage ? chalk.green(' ← integration trigger') : '';
        console.log(`  ${chalk.dim(`${i + 1}.`)} ${prefix}${name}${marker}`);
    }
    console.log();
    console.log(`     ${getStageEmoji('needs_attention')} needs_attention${chalk.yellow(' (non-linear — enter from any stage, advance to resume)')}`);
    console.log();
    console.log(chalk.dim('Configure with: ghp config pipeline.stages \'["stage1", "stage2", ...]\''));
    console.log(chalk.dim('Integration trigger: ghp config pipeline.integrationAfter "<stage>"'));
}

// ---------------------------------------------------------------------------
// New agent-* commands
// ---------------------------------------------------------------------------

/**
 * ghp pipeline agent-active
 *
 * Called from Claude Code PostToolUse hook. Sets pipeline stage to 'working'
 * (idempotent) and runs user scripts from .ghp/hooks/agent-active.
 */
export async function pipelineAgentActiveCommand(): Promise<void> {
    const input = await readStdin();
    if (!input.trim()) return;

    let hookData: { cwd?: string; [key: string]: any };
    try {
        hookData = JSON.parse(input);
    } catch {
        return;
    }

    const { cwd } = hookData;
    if (!cwd) return;

    const resolved = await resolveFromCwd(cwd);
    if (!resolved) return;

    const { repoRoot, issueNumber } = resolved;

    // Set to 'working' — idempotent, no-op if already 'working'
    const entry = getPipelineEntry(repoRoot, issueNumber);
    if (entry && entry.stage !== 'working') {
        setWorktreeStage(repoRoot, issueNumber, 'working');
    }

    // Fire user hook script (fire-and-forget)
    runUserHookScript('agent-active', input, cwd);
}

/**
 * ghp pipeline agent-stopped
 *
 * Called from Claude Code Stop hook. Sets pipeline stage to 'stopped'
 * and runs user scripts from .ghp/hooks/agent-stopped.
 */
export async function pipelineAgentStoppedCommand(): Promise<void> {
    const input = await readStdin();
    if (!input.trim()) return;

    let hookData: { cwd?: string; [key: string]: any };
    try {
        hookData = JSON.parse(input);
    } catch {
        return;
    }

    const { cwd } = hookData;
    if (!cwd) return;

    const resolved = await resolveFromCwd(cwd);
    if (!resolved) return;

    const { repoRoot, issueNumber } = resolved;

    // Set to 'stopped'
    const entry = getPipelineEntry(repoRoot, issueNumber);
    if (entry && entry.stage !== 'stopped') {
        setWorktreeStage(repoRoot, issueNumber, 'stopped');
    }

    // Fire user hook script (fire-and-forget)
    runUserHookScript('agent-stopped', input, cwd);
}

/**
 * ghp pipeline agent-focused <issue> [--mode <mode>]
 *
 * Called from the dashboard's pullAgentPane(). Runs user scripts
 * from .ghp/hooks/agent-focused (with mode-aware resolution).
 */
export async function pipelineAgentFocusedCommand(issueArg: string, options?: { mode?: string }): Promise<void> {
    const issueNumber = parseInt(issueArg, 10);
    if (isNaN(issueNumber)) return;

    const repoRoot = await getMainWorktreeRoot();
    if (!repoRoot) return;

    const entry = getPipelineEntry(repoRoot, issueNumber);
    if (!entry) return;

    const payload = JSON.stringify({
        issueNumber,
        worktreePath: entry.worktreePath,
        branch: entry.branch,
    });

    runUserHookScript('agent-focused', payload, entry.worktreePath, options?.mode);
}

/**
 * ghp pipeline agent-unfocused <issue> [--mode <mode>]
 *
 * Called from the dashboard's sendPaneBack(). Runs user scripts
 * from .ghp/hooks/agent-unfocused (with mode-aware resolution).
 */
export async function pipelineAgentUnfocusedCommand(issueArg: string, options?: { mode?: string }): Promise<void> {
    const issueNumber = parseInt(issueArg, 10);
    if (isNaN(issueNumber)) return;

    const repoRoot = await getMainWorktreeRoot();
    if (!repoRoot) return;

    const entry = getPipelineEntry(repoRoot, issueNumber);
    if (!entry) return;

    const payload = JSON.stringify({
        issueNumber,
        worktreePath: entry.worktreePath,
        branch: entry.branch,
    });

    runUserHookScript('agent-unfocused', payload, entry.worktreePath, options?.mode);
}

/**
 * ghp pipeline agent-swapped <oldIssue> <newIssue> [--mode <mode>]
 *
 * Called from the dashboard when switching directly from one focused agent
 * to another. Fires a single `agent-swapped` hook (with mode suffix if
 * applicable). Falls back to sequential unfocus→focus if no swapped hook exists.
 */
export async function pipelineAgentSwappedCommand(
    oldIssueArg: string,
    newIssueArg: string,
    options?: { mode?: string }
): Promise<void> {
    const oldIssue = parseInt(oldIssueArg, 10);
    const newIssue = parseInt(newIssueArg, 10);
    if (isNaN(oldIssue) || isNaN(newIssue)) return;

    const repoRoot = await getMainWorktreeRoot();
    if (!repoRoot) return;

    const oldEntry = getPipelineEntry(repoRoot, oldIssue);
    const newEntry = getPipelineEntry(repoRoot, newIssue);
    if (!oldEntry || !newEntry) return;

    const mode = options?.mode;

    // Check if agent-swapped hook exists (with mode resolution)
    const swapScript = resolveHookScript(repoRoot, 'agent-swapped', mode);

    if (swapScript) {
        // Fire atomic agent-swapped hook
        const payload = JSON.stringify({
            old: { issueNumber: oldIssue, worktreePath: oldEntry.worktreePath, branch: oldEntry.branch },
            new: { issueNumber: newIssue, worktreePath: newEntry.worktreePath, branch: newEntry.branch },
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
        } catch {
            // Silent
        }
    } else {
        // Fallback: sequential unfocus→focus (respecting hookModeSwapOrder)
        const pipelineConfig = getConfig('pipeline') as any;
        const swapOrder = pipelineConfig?.hookModeSwapOrder ?? 'unfocus-first';

        const unfocusPayload = JSON.stringify({
            issueNumber: oldIssue,
            worktreePath: oldEntry.worktreePath,
            branch: oldEntry.branch,
        });
        const focusPayload = JSON.stringify({
            issueNumber: newIssue,
            worktreePath: newEntry.worktreePath,
            branch: newEntry.branch,
        });

        // Await the first to guarantee ordering; second is fire-and-forget
        if (swapOrder === 'focus-first') {
            await runUserHookScript('agent-focused', focusPayload, newEntry.worktreePath, mode);
            runUserHookScript('agent-unfocused', unfocusPayload, oldEntry.worktreePath, mode);
        } else {
            await runUserHookScript('agent-unfocused', unfocusPayload, oldEntry.worktreePath, mode);
            runUserHookScript('agent-focused', focusPayload, newEntry.worktreePath, mode);
        }
    }
}

/**
 * ghp pipeline mode [name]
 *
 * Get or set the current hook mode. Without args, prints current mode.
 * With a name, validates against configured hookModes and prints the new mode.
 * (Runtime mode changes happen in the dashboard; this command is for scripting.)
 */
export async function pipelineModeCommand(modeName?: string): Promise<void> {
    const pipelineConfig = getConfig('pipeline') as any;
    const hookModes: string[] = pipelineConfig?.hookModes ?? [];

    if (!modeName) {
        // Print available modes
        if (hookModes.length === 0) {
            console.log(chalk.dim('No hook modes configured.'));
            console.log(chalk.dim('Configure with: ghp config pipeline.hookModes \'["planning","testing"]\''));
        } else {
            const defaultMode = pipelineConfig?.defaultHookMode;
            console.log(chalk.bold('Hook Modes'));
            for (const mode of hookModes) {
                const marker = mode === defaultMode ? chalk.green(' (default)') : '';
                console.log(`  ${chalk.cyan(mode)}${marker}`);
            }
        }
        return;
    }

    if (!hookModes.includes(modeName)) {
        console.error(chalk.red('Error:'), `Unknown mode: ${modeName}`);
        console.error('Available modes:', hookModes.join(', ') || '(none configured)');
        exit(1);
        return;
    }

    console.log(chalk.green('✓'), `Mode: ${chalk.cyan(modeName)}`);
}

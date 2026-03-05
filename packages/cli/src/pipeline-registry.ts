/**
 * Pipeline registry — configurable stage-based workflow for worktrees.
 *
 * Stages are defined in ghp config under `pipeline.stages` as an ordered array
 * of stage names. A worktree advances linearly through stages.
 *
 * Stored in .git/ghp-pipeline.json.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { getConfig } from './config.js';

// ---------------------------------------------------------------------------
// Default stages
// ---------------------------------------------------------------------------

const DEFAULT_STAGES = ['working', 'stopped'];

/**
 * Special non-linear stage. Can be entered from any stage; advancing from it
 * restores the previous stage. Not part of the linear pipeline.
 */
const NEEDS_ATTENTION = 'needs_attention';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineEntry {
    issueNumber: number;
    issueTitle: string;
    branch: string;
    worktreePath: string;
    /** Current stage name (from configured stages list, or 'needs_attention') */
    stage: string;
    /** Stage before entering needs_attention (used to restore on advance) */
    previousStage?: string;
    /** ISO timestamp of when the entry moved to the current stage */
    stageEnteredAt: string;
    /** ISO timestamp of initial registration */
    registeredAt: string;
}

type PipelineRegistry = Record<string, PipelineEntry>;

// ---------------------------------------------------------------------------
// Stage configuration
// ---------------------------------------------------------------------------

/** Get the configured pipeline stages (or defaults). */
export function getPipelineStages(): string[] {
    const config = getConfig('pipeline') as any;
    const stages = config?.stages;
    if (Array.isArray(stages) && stages.length > 0) return stages;
    return DEFAULT_STAGES;
}

/** Get the stage name after which integration testing (swap to main) is triggered. */
export function getIntegrationTriggerStage(): string {
    const config = getConfig('pipeline') as any;
    return config?.integrationAfter ?? 'ready_for_integration';
}

/** Get the index of a stage in the pipeline (-1 if not found). */
export function getStageIndex(stageName: string): number {
    return getPipelineStages().indexOf(stageName);
}

// ---------------------------------------------------------------------------
// Stage emoji mapping
// ---------------------------------------------------------------------------

const STAGE_EMOJIS: Record<string, string> = {
    working: '🔨',
    stopped: '⏸',
    needs_attention: '🚨',
};

/** Get the emoji for a pipeline stage. Returns empty string for unknown stages. */
export function getStageEmoji(stage: string): string {
    return STAGE_EMOJIS[stage] ?? '';
}

/** Rename the tmux window for an issue to reflect its current stage. */
function renameWorktreeWindow(issueNumber: number, stage: string): void {
    const emoji = getStageEmoji(stage);
    const prefix = emoji ? `${emoji} ` : '';
    const windowName = `ghp-${issueNumber}`;
    try {
        execFileSync('tmux', ['rename-window', '-t', windowName, `${prefix}${windowName}`], { stdio: 'ignore' });
    } catch { /* not in tmux or window doesn't exist — fine */ }
}

// ---------------------------------------------------------------------------
// Registry I/O
// ---------------------------------------------------------------------------

function getRegistryPath(repoRoot: string): string {
    return join(repoRoot, '.git', 'ghp-pipeline.json');
}

function loadRegistry(repoRoot: string): PipelineRegistry {
    const path = getRegistryPath(repoRoot);
    if (!existsSync(path)) return {};
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as PipelineRegistry;
    } catch {
        return {};
    }
}

function saveRegistry(repoRoot: string, registry: PipelineRegistry): void {
    writeFileSync(getRegistryPath(repoRoot), JSON.stringify(registry, null, 2));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Register a new worktree at the first stage (default: 'working'). */
export function registerWorktree(
    repoRoot: string,
    entry: Omit<PipelineEntry, 'stage' | 'previousStage' | 'stageEnteredAt' | 'registeredAt'>
): PipelineEntry {
    const registry = loadRegistry(repoRoot);
    const stages = getPipelineStages();
    const now = new Date().toISOString();
    const full: PipelineEntry = {
        ...entry,
        stage: stages[0],
        stageEnteredAt: now,
        registeredAt: now,
    };
    registry[String(entry.issueNumber)] = full;
    saveRegistry(repoRoot, registry);
    renameWorktreeWindow(entry.issueNumber, stages[0]);
    return full;
}

/** Advance a worktree to the next stage in the pipeline. Returns null if not found or already at last stage.
 *  If currently at needs_attention, restores to the previous stage instead of advancing. */
export function advanceWorktreeStage(repoRoot: string, issueNumber: number): PipelineEntry | null {
    const registry = loadRegistry(repoRoot);
    const entry = registry[String(issueNumber)];
    if (!entry) return null;

    // Restore from needs_attention → go back to where we were
    if (entry.stage === NEEDS_ATTENTION && entry.previousStage) {
        entry.stage = entry.previousStage;
        delete entry.previousStage;
        entry.stageEnteredAt = new Date().toISOString();
        saveRegistry(repoRoot, registry);
        renameWorktreeWindow(issueNumber, entry.stage);
        return entry;
    }

    const stages = getPipelineStages();
    const currentIndex = stages.indexOf(entry.stage);
    if (currentIndex < 0 || currentIndex >= stages.length - 1) return entry;

    entry.stage = stages[currentIndex + 1];
    delete entry.previousStage;
    entry.stageEnteredAt = new Date().toISOString();
    saveRegistry(repoRoot, registry);
    renameWorktreeWindow(issueNumber, entry.stage);
    return entry;
}

/** Set a worktree to a specific stage by name. Accepts linear stages and 'needs_attention'. */
export function setWorktreeStage(repoRoot: string, issueNumber: number, stageName: string): PipelineEntry | null {
    const registry = loadRegistry(repoRoot);
    const entry = registry[String(issueNumber)];
    if (!entry) return null;

    const stages = getPipelineStages();
    if (!stages.includes(stageName) && stageName !== NEEDS_ATTENTION) return null;

    // Entering needs_attention: save current stage so advance can restore it
    if (stageName === NEEDS_ATTENTION && entry.stage !== NEEDS_ATTENTION) {
        entry.previousStage = entry.stage;
    }
    // Leaving needs_attention via explicit set: clear previousStage
    if (stageName !== NEEDS_ATTENTION) {
        delete entry.previousStage;
    }

    entry.stage = stageName;
    entry.stageEnteredAt = new Date().toISOString();
    saveRegistry(repoRoot, registry);
    renameWorktreeWindow(issueNumber, stageName);
    return entry;
}

/** Remove a worktree from the pipeline. */
export function deregisterWorktree(repoRoot: string, issueNumber: number): void {
    const registry = loadRegistry(repoRoot);
    delete registry[String(issueNumber)];
    saveRegistry(repoRoot, registry);
}

/** Get a single entry. */
export function getPipelineEntry(repoRoot: string, issueNumber: number): PipelineEntry | null {
    return loadRegistry(repoRoot)[String(issueNumber)] ?? null;
}

/** Get all entries. */
export function getAllPipelineEntries(repoRoot: string): PipelineEntry[] {
    return Object.values(loadRegistry(repoRoot));
}

/** Get entries at a specific stage, sorted FIFO by stageEnteredAt. */
export function getWorktreesAtStage(repoRoot: string, stageName: string): PipelineEntry[] {
    return getAllPipelineEntries(repoRoot)
        .filter(e => e.stage === stageName)
        .sort((a, b) => a.stageEnteredAt.localeCompare(b.stageEnteredAt));
}

/**
 * Get worktrees that have reached the integration trigger stage,
 * sorted FIFO by stageEnteredAt.
 */
export function getReadyWorktrees(repoRoot: string): PipelineEntry[] {
    const triggerStage = getIntegrationTriggerStage();
    return getWorktreesAtStage(repoRoot, triggerStage);
}

/** Check if a stage is at or past the integration trigger point. */
export function isAtOrPastIntegration(stageName: string): boolean {
    if (stageName === NEEDS_ATTENTION) return false;
    const stages = getPipelineStages();
    const triggerIndex = stages.indexOf(getIntegrationTriggerStage());
    const stageIndex = stages.indexOf(stageName);
    return stageIndex >= triggerIndex && triggerIndex >= 0;
}

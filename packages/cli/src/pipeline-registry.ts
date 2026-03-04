/**
 * Pipeline registry for tracking worktrees through workflow stages.
 *
 * Stored in .git/ghp-pipeline.json (alongside swap state).
 * Populated when ghp start --parallel creates a worktree.
 * Updated by ghp wt ready, ghp wt next, ghp wt clean.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export type PipelineStage = 1 | 2 | 3;
export type PipelineStageStatus = 'in_progress' | 'ready' | 'done';

export interface PipelineEntry {
    issueNumber: number;
    issueTitle: string;
    branch: string;
    worktreePath: string;
    stage: PipelineStage;
    stageStatus: PipelineStageStatus;
    /** ISO timestamp when stageStatus was set to 'ready' */
    readyAt?: string;
    /** ISO timestamp of initial registration */
    registeredAt: string;
}

type PipelineRegistry = Record<string, PipelineEntry>;

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

/** Register a new worktree at stage 1 / in_progress. */
export function registerWorktree(
    repoRoot: string,
    entry: Omit<PipelineEntry, 'stage' | 'stageStatus' | 'registeredAt'>
): PipelineEntry {
    const registry = loadRegistry(repoRoot);
    const full: PipelineEntry = {
        ...entry,
        stage: 1,
        stageStatus: 'in_progress',
        registeredAt: new Date().toISOString(),
    };
    registry[String(entry.issueNumber)] = full;
    saveRegistry(repoRoot, registry);
    return full;
}

/** Mark the current stage as complete (ready to advance). */
export function markWorktreeReady(repoRoot: string, issueNumber: number): PipelineEntry | null {
    const registry = loadRegistry(repoRoot);
    const entry = registry[String(issueNumber)];
    if (!entry) return null;
    entry.stageStatus = 'ready';
    entry.readyAt = new Date().toISOString();
    saveRegistry(repoRoot, registry);
    return entry;
}

/** Advance a worktree to the next stage (1→2 or 2→3). */
export function advanceWorktreeStage(repoRoot: string, issueNumber: number): PipelineEntry | null {
    const registry = loadRegistry(repoRoot);
    const entry = registry[String(issueNumber)];
    if (!entry) return null;
    if (entry.stage < 3) {
        entry.stage = (entry.stage + 1) as PipelineStage;
        entry.stageStatus = 'in_progress';
        delete entry.readyAt;
    }
    saveRegistry(repoRoot, registry);
    return entry;
}

/** Mark a worktree's stage as done (e.g. PR opened at end of stage 3). */
export function markWorktreeDone(repoRoot: string, issueNumber: number): PipelineEntry | null {
    const registry = loadRegistry(repoRoot);
    const entry = registry[String(issueNumber)];
    if (!entry) return null;
    entry.stageStatus = 'done';
    saveRegistry(repoRoot, registry);
    return entry;
}

/** Remove a worktree from the pipeline (e.g. when worktree is deleted). */
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

/** Get all entries with stageStatus === 'ready', sorted FIFO by readyAt. */
export function getReadyWorktrees(repoRoot: string): PipelineEntry[] {
    return getAllPipelineEntries(repoRoot)
        .filter(e => e.stageStatus === 'ready')
        .sort((a, b) => {
            if (!a.readyAt) return 1;
            if (!b.readyAt) return -1;
            return a.readyAt.localeCompare(b.readyAt);
        });
}

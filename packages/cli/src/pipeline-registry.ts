/**
 * Pipeline registry — configurable stage-based workflow for worktrees.
 *
 * Stages are defined in ghp config under `pipeline.stages` as an ordered array
 * of stage names. A worktree advances linearly through stages.
 *
 * Stored in .git/ghp-pipeline.json.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getConfig } from './config.js';

// ---------------------------------------------------------------------------
// Default stages
// ---------------------------------------------------------------------------

const DEFAULT_STAGES = [
    'initiating',
    'planning',
    'plan_ready',
    'building_tests',
    'working',
    'needs_attention',
    'code_review',
    'ready_for_integration',
    'integration_testing',
    'code_review_loop',
    'writing_pr',
    'pr_submitted',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineEntry {
    issueNumber: number;
    issueTitle: string;
    branch: string;
    worktreePath: string;
    /** Current stage name (from configured stages list) */
    stage: string;
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

/** Register a new worktree at the first stage (typically 'initiating'). */
export function registerWorktree(
    repoRoot: string,
    entry: Omit<PipelineEntry, 'stage' | 'stageEnteredAt' | 'registeredAt'>
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
    return full;
}

/** Advance a worktree to the next stage in the pipeline. Returns null if not found or already at last stage. */
export function advanceWorktreeStage(repoRoot: string, issueNumber: number): PipelineEntry | null {
    const registry = loadRegistry(repoRoot);
    const entry = registry[String(issueNumber)];
    if (!entry) return null;

    const stages = getPipelineStages();
    const currentIndex = stages.indexOf(entry.stage);
    if (currentIndex < 0 || currentIndex >= stages.length - 1) return entry;

    entry.stage = stages[currentIndex + 1];
    entry.stageEnteredAt = new Date().toISOString();
    saveRegistry(repoRoot, registry);
    return entry;
}

/** Set a worktree to a specific stage by name. */
export function setWorktreeStage(repoRoot: string, issueNumber: number, stageName: string): PipelineEntry | null {
    const registry = loadRegistry(repoRoot);
    const entry = registry[String(issueNumber)];
    if (!entry) return null;

    const stages = getPipelineStages();
    if (!stages.includes(stageName)) return null;

    entry.stage = stageName;
    entry.stageEnteredAt = new Date().toISOString();
    saveRegistry(repoRoot, registry);
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
    const stages = getPipelineStages();
    const triggerIndex = stages.indexOf(getIntegrationTriggerStage());
    const stageIndex = stages.indexOf(stageName);
    return stageIndex >= triggerIndex && triggerIndex >= 0;
}

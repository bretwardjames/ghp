/**
 * Shared swap state helpers — extracted so both worktree-swap.ts and status.ts
 * can read/write swap state without a circular import.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

export interface SwapState {
    /** Branch main was on before the swap */
    mainBranch: string;
    /** Absolute path to the worktree */
    worktreePath: string;
    /** Branch the worktree was (and should return to) */
    worktreeBranch: string;
    /** ISO timestamp */
    swappedAt: string;
}

export function getStateFilePath(repoRoot: string): string {
    return join(repoRoot, '.git', 'ghp-wt-state.json');
}

export function readSwapState(repoRoot: string): SwapState | null {
    const path = getStateFilePath(repoRoot);
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as SwapState;
    } catch {
        return null;
    }
}

export function writeSwapState(repoRoot: string, state: SwapState): void {
    writeFileSync(getStateFilePath(repoRoot), JSON.stringify(state, null, 2));
}

export function clearSwapState(repoRoot: string): void {
    const path = getStateFilePath(repoRoot);
    if (existsSync(path)) unlinkSync(path);
}

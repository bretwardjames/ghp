/**
 * Workflows - Centralized Operations with Hook Firing
 *
 * This module provides workflow functions that combine operations with
 * automatic hook firing. All entry points (CLI, MCP, VS Code, nvim)
 * should use these workflows to ensure consistent hook behavior.
 *
 * @example
 * ```typescript
 * import {
 *   createIssueWorkflow,
 *   startIssueWorkflow,
 *   createPRWorkflow,
 *   createWorktreeWorkflow,
 *   removeWorktreeWorkflow,
 * } from '@bretwardjames/ghp-core';
 *
 * // Create an issue with hooks
 * const result = await createIssueWorkflow(api, {
 *   repo,
 *   title: 'New feature',
 *   projectId: 'PVT_xxx',
 * });
 *
 * // Hook results are included in the response
 * for (const hookResult of result.hookResults) {
 *   console.log(`Hook ${hookResult.hookName}: ${hookResult.success ? 'OK' : 'FAILED'}`);
 * }
 * ```
 */

// =============================================================================
// Workflow Functions
// =============================================================================

export { createIssueWorkflow, startIssueWorkflow } from './issue.js';
export { createPRWorkflow } from './pr.js';
export { createWorktreeWorkflow, removeWorktreeWorkflow } from './worktree.js';

// =============================================================================
// Types
// =============================================================================

export type {
    // Common types
    WorkflowResult,
    IssueInfo,
    WorktreeInfo,

    // Issue workflow types
    CreateIssueOptions,
    CreateIssueResult,
    StartIssueOptions,
    StartIssueResult,

    // PR workflow types
    CreatePROptions,
    CreatePRResult,
    PRInfo,

    // Worktree workflow types
    CreateWorktreeOptions,
    CreateWorktreeResult,
    RemoveWorktreeOptions,
    RemoveWorktreeResult,
} from './types.js';

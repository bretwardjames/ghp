/**
 * Workflow Types
 *
 * Types for the workflow layer that encapsulates operations + hook firing.
 * Workflows are used by CLI, MCP, VS Code extension, and nvim plugin.
 */

import type { HookResult } from '../plugins/types.js';
import type { RepoInfo } from '../types.js';

// =============================================================================
// Common Types
// =============================================================================

/**
 * Base result for all workflows
 */
export interface WorkflowResult {
    /** Whether the workflow completed successfully */
    success: boolean;
    /** Error message if success is false */
    error?: string;
    /** Results from any hooks that were fired */
    hookResults: HookResult[];
}

/**
 * Issue information used across workflows
 */
export interface IssueInfo {
    number: number;
    title: string;
    body?: string;
    url: string;
}

/**
 * Worktree information
 */
export interface WorktreeInfo {
    /** Absolute path to the worktree */
    path: string;
    /** Directory name of the worktree */
    name: string;
}

// =============================================================================
// Create Issue Workflow
// =============================================================================

/**
 * Options for creating an issue
 */
export interface CreateIssueOptions {
    /** Repository info */
    repo: RepoInfo;
    /** Issue title */
    title: string;
    /** Issue body/description */
    body?: string;
    /** Project ID to add the issue to */
    projectId: string;
    /** Initial status name (optional) */
    status?: string;
    /** Labels to apply (optional) */
    labels?: string[];
    /** Users to assign (optional) */
    assignees?: string[];
    /** Parent issue number for sub-issues (optional) */
    parentIssueNumber?: number;
}

/**
 * Result of creating an issue
 */
export interface CreateIssueResult extends WorkflowResult {
    /** Created issue info (if successful) */
    issue?: IssueInfo;
    /** Project item ID (if added to project) */
    projectItemId?: string;
}

// =============================================================================
// Start Issue Workflow
// =============================================================================

/**
 * Options for starting work on an issue
 */
export interface StartIssueOptions {
    /** Repository info */
    repo: RepoInfo;
    /** Issue number to start working on */
    issueNumber: number;
    /** Issue title (if known, avoids API call) */
    issueTitle?: string;
    /** Branch to work on (if already known/linked) */
    linkedBranch?: string;
    /** Whether to create a parallel worktree */
    parallel?: boolean;
    /** Custom path for worktree (only used with parallel) */
    worktreePath?: string;
    /** Whether this is review mode (skip status/label changes) */
    review?: boolean;
    /** Branch pattern for new branches */
    branchPattern?: string;
    /** Username for branch naming */
    username?: string;
    /** Target status to set */
    targetStatus?: string;
    /** Project ID (if known) */
    projectId?: string;
    /** Status field ID (if known) */
    statusFieldId?: string;
    /** Status option ID (if known) */
    statusOptionId?: string;
}

/**
 * Result of starting work on an issue
 */
export interface StartIssueResult extends WorkflowResult {
    /** The branch being worked on */
    branch?: string;
    /** Whether a new branch was created */
    branchCreated?: boolean;
    /** Worktree info if parallel mode was used */
    worktree?: WorktreeInfo;
    /** Whether a new worktree was created */
    worktreeCreated?: boolean;
    /** Issue info */
    issue?: IssueInfo;
}

// =============================================================================
// Create PR Workflow
// =============================================================================

/**
 * Options for creating a pull request
 */
export interface CreatePROptions {
    /** Repository info */
    repo: RepoInfo;
    /** PR title */
    title: string;
    /** PR body/description */
    body?: string;
    /** Base branch (default: main) */
    baseBranch?: string;
    /** Head branch (default: current branch) */
    headBranch?: string;
    /** Linked issue number (optional) */
    issueNumber?: number;
    /** Linked issue title (optional, for hooks) */
    issueTitle?: string;
    /** Whether to open in browser after creation */
    openInBrowser?: boolean;
    /** Skip all hooks (--no-hooks flag) */
    skipHooks?: boolean;
    /** Force PR creation even if blocking hooks fail (--force flag) */
    force?: boolean;
}

/**
 * PR information
 */
export interface PRInfo {
    number: number;
    title: string;
    body?: string;
    url: string;
}

/**
 * Result of creating a pull request
 */
export interface CreatePRResult extends WorkflowResult {
    /** Created PR info (if successful) */
    pr?: PRInfo;
    /** Linked issue info (if any) */
    issue?: IssueInfo;
    /** Hook name that aborted the workflow (if any) */
    abortedByHook?: string;
    /** Hook event that caused the abort (pre-pr or pr-creating) */
    abortedAtEvent?: 'pre-pr' | 'pr-creating';
}

// =============================================================================
// Worktree Workflows
// =============================================================================

/**
 * Options for creating a worktree
 */
export interface CreateWorktreeOptions {
    /** Repository info */
    repo: RepoInfo;
    /** Issue number (for hooks) */
    issueNumber?: number;
    /** Issue title (for hooks) */
    issueTitle?: string;
    /** Branch to checkout in the worktree */
    branch: string;
    /** Full path for the worktree (required - caller determines path based on config) */
    path: string;
}

/**
 * Result of creating a worktree
 */
export interface CreateWorktreeResult extends WorkflowResult {
    /** Worktree info */
    worktree?: WorktreeInfo;
    /** Whether the worktree already existed */
    alreadyExisted?: boolean;
    /** Branch name */
    branch?: string;
}

/**
 * Options for removing a worktree
 */
export interface RemoveWorktreeOptions {
    /** Repository info */
    repo: RepoInfo;
    /** Issue number (for finding worktree and hooks) */
    issueNumber: number;
    /** Issue title (for hooks, optional) */
    issueTitle?: string;
    /** Branch name (if known, avoids lookup) */
    branch?: string;
    /** Worktree path (if known, avoids lookup) */
    worktreePath?: string;
    /** Force removal even with uncommitted changes */
    force?: boolean;
}

/**
 * Result of removing a worktree
 */
export interface RemoveWorktreeResult extends WorkflowResult {
    /** Removed worktree info */
    worktree?: WorktreeInfo;
    /** Branch that was in the worktree */
    branch?: string;
}

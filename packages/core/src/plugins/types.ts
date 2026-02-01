/**
 * Event Hooks System Types
 *
 * Event hooks allow external tools to respond to ghp lifecycle events.
 * Hooks are shell commands with template variable substitution.
 */

// =============================================================================
// Event Types
// =============================================================================

/**
 * Lifecycle events that hooks can subscribe to
 */
export type EventType =
    | 'issue-created'     // After ghp add creates an issue
    | 'issue-started'     // After ghp start creates/switches to branch
    | 'pr-created'        // After ghp pr --create
    | 'pr-merged'         // After PR merge detected
    | 'worktree-created'  // After ghp start --parallel creates a worktree
    | 'worktree-removed'; // After ghp worktree remove removes a worktree

// =============================================================================
// Event Hook
// =============================================================================

/**
 * A registered event hook
 */
export interface EventHook {
    /** Unique identifier for the hook */
    name: string;
    /** Human-readable display name */
    displayName?: string;
    /** The event that triggers this hook */
    event: EventType;
    /**
     * Shell command to execute. Supports template variables:
     * - ${issue.number} - Issue number
     * - ${issue.json} - Full issue JSON (escaped for shell)
     * - ${branch} - Branch name
     * - ${pr.number} - PR number
     * - ${pr.json} - Full PR JSON (escaped for shell)
     * - ${repo} - Repository in owner/name format
     * - ${worktree.path} - Absolute path to worktree
     * - ${worktree.name} - Directory name of worktree
     */
    command: string;
    /** Whether the hook is enabled (default: true) */
    enabled: boolean;
    /** Maximum execution time in milliseconds (default: 30000) */
    timeout?: number;
}

// =============================================================================
// Event Hook Configuration
// =============================================================================

/**
 * Event hooks configuration file structure
 */
export interface EventHooksConfig {
    hooks: EventHook[];
}

// =============================================================================
// Event Payloads
// =============================================================================

/**
 * Base payload for all events
 */
export interface BaseEventPayload {
    /** Repository in owner/name format */
    repo: string;
}

/**
 * Payload for issue-created event
 */
export interface IssueCreatedPayload extends BaseEventPayload {
    issue: {
        number: number;
        title: string;
        body: string;
        url: string;
        [key: string]: unknown;
    };
}

/**
 * Payload for issue-started event
 */
export interface IssueStartedPayload extends BaseEventPayload {
    issue: {
        number: number;
        title: string;
        body: string;
        url: string;
        [key: string]: unknown;
    };
    branch: string;
}

/**
 * Payload for pr-created event
 */
export interface PrCreatedPayload extends BaseEventPayload {
    pr: {
        number: number;
        title: string;
        body: string;
        url: string;
        [key: string]: unknown;
    };
    issue?: {
        number: number;
        title: string;
        body: string;
        url: string;
        [key: string]: unknown;
    };
    branch: string;
}

/**
 * Payload for pr-merged event
 */
export interface PrMergedPayload extends BaseEventPayload {
    pr: {
        number: number;
        title: string;
        url: string;
        [key: string]: unknown;
    };
    branch: string;
}

/**
 * Payload for worktree-created event
 */
export interface WorktreeCreatedPayload extends BaseEventPayload {
    issue?: {
        number: number;
        title: string;
        body?: string;
        url: string;
        [key: string]: unknown;
    };
    branch: string;
    worktree: {
        /** Absolute path to the worktree */
        path: string;
        /** Directory name of the worktree */
        name: string;
    };
}

/**
 * Payload for worktree-removed event
 */
export interface WorktreeRemovedPayload extends BaseEventPayload {
    issue?: {
        number: number;
        title: string;
        body?: string;
        url: string;
        [key: string]: unknown;
    };
    branch: string;
    worktree: {
        /** Absolute path to the worktree */
        path: string;
        /** Directory name of the worktree */
        name: string;
    };
}

/**
 * Union of all event payloads
 */
export type EventPayload =
    | IssueCreatedPayload
    | IssueStartedPayload
    | PrCreatedPayload
    | PrMergedPayload
    | WorktreeCreatedPayload
    | WorktreeRemovedPayload;

// =============================================================================
// Execution Results
// =============================================================================

/**
 * Result of executing an event hook
 */
export interface HookResult {
    /** Hook name */
    hookName: string;
    /** Whether the hook executed successfully */
    success: boolean;
    /** Output from the command (stdout) */
    output?: string;
    /** Error message if the hook failed */
    error?: string;
    /** Execution time in milliseconds */
    duration?: number;
}

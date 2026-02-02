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
    | 'pre-pr'            // Before PR creation begins (validation/linting)
    | 'pr-creating'       // Just before GitHub API call (suggest title/body)
    | 'pr-created'        // After ghp pr --create
    | 'pr-merged'         // After ghp merge completes
    | 'worktree-created'  // After ghp start --parallel creates a worktree
    | 'worktree-removed'; // After ghp worktree remove removes a worktree

// =============================================================================
// Hook Modes
// =============================================================================

/**
 * Hook execution modes that control behavior on completion
 *
 * - fire-and-forget: Silent execution, logged only, never aborts workflow (default)
 * - blocking: Output shown on failure, non-zero exit aborts workflow
 * - interactive: Always show output, prompt user to continue/abort/view
 */
export type HookMode = 'fire-and-forget' | 'blocking' | 'interactive';

/**
 * Exit code classification for determining hook outcome
 */
export interface HookExitCodes {
    /** Exit codes that indicate success (default: [0]) */
    success?: number[];
    /** Exit codes that should abort the workflow (default: [1]) */
    abort?: number[];
    /** Exit codes that warn but continue (default: []) */
    warn?: number[];
}

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
     * - ${base} - Target base branch (pre-pr, pr-creating, pr-merged)
     * - ${pr.number} - PR number
     * - ${pr.title} - PR title
     * - ${pr.url} - PR URL
     * - ${pr.merged_at} - ISO timestamp when PR was merged (pr-merged only)
     * - ${pr.json} - Full PR JSON (escaped for shell)
     * - ${repo} - Repository in owner/name format
     * - ${worktree.path} - Absolute path to worktree
     * - ${worktree.name} - Directory name of worktree
     * - ${changed_files} - JSON array of changed file paths (pre-pr only)
     * - ${diff_stat.additions} - Number of lines added (pre-pr only)
     * - ${diff_stat.deletions} - Number of lines deleted (pre-pr only)
     * - ${diff_stat.files_changed} - Number of files changed (pre-pr only)
     * - ${title} - Proposed PR title (pr-creating only)
     * - ${body} - Proposed PR body (pr-creating only)
     * - ${_event_file} - Path to temp file containing full event payload as JSON
     *                    (useful for complex data with arrays/nested objects)
     */
    command: string;
    /** Whether the hook is enabled (default: true) */
    enabled: boolean;
    /** Maximum execution time in milliseconds (default: 30000) */
    timeout?: number;
    /** Execution mode controlling behavior on completion (default: 'fire-and-forget') */
    mode?: HookMode;
    /** Custom exit code classification (defaults: success=[0], abort=[1], warn=[]) */
    exitCodes?: HookExitCodes;
    /** Custom prompt text for interactive mode (default: 'Continue?') */
    continuePrompt?: string;
}

// =============================================================================
// Event Hook Configuration
// =============================================================================

/**
 * Event hooks configuration file structure
 */
export interface EventHooksConfig {
    hooks: EventHook[];
    /** Per-event execution settings (overrides global defaults) */
    eventDefaults?: Partial<Record<EventType, EventHookSettings>>;
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
        merged_at: string;
        [key: string]: unknown;
    };
    branch: string;
    /** The base branch the PR was merged into */
    base: string;
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
 * Payload for pre-pr event
 * Fired before PR creation begins, for validation/linting
 */
export interface PrePrPayload extends BaseEventPayload {
    /** Source branch for the PR */
    branch: string;
    /** Target base branch */
    base: string;
    /** List of changed file paths */
    changed_files: string[];
    /** Diff statistics */
    diff_stat: {
        additions: number;
        deletions: number;
        files_changed: number;
    };
}

/**
 * Payload for pr-creating event
 * Fired just before GitHub API call, allows suggesting title/body
 */
export interface PrCreatingPayload extends BaseEventPayload {
    /** Source branch for the PR */
    branch: string;
    /** Target base branch */
    base: string;
    /** Proposed PR title */
    title: string;
    /** Proposed PR body/description */
    body: string;
}

/**
 * Union of all event payloads
 */
export type EventPayload =
    | IssueCreatedPayload
    | IssueStartedPayload
    | PrePrPayload
    | PrCreatingPayload
    | PrCreatedPayload
    | PrMergedPayload
    | WorktreeCreatedPayload
    | WorktreeRemovedPayload;

// =============================================================================
// Execution Results
// =============================================================================

/**
 * Outcome of hook execution based on mode and exit code
 */
export type HookOutcome = 'success' | 'warn' | 'abort' | 'continue';

/**
 * Behavior when a hook fails (aborts)
 * - 'fail-fast': Stop executing hooks on first failure (default)
 * - 'continue': Run all hooks, collect all failures
 */
export type OnFailureBehavior = 'fail-fast' | 'continue';

/**
 * Per-event hook execution settings
 */
export interface EventHookSettings {
    /** Behavior when a hook fails for this event */
    onFailure?: OnFailureBehavior;
}

/**
 * Result of executing an event hook
 */
export interface HookResult {
    /** Hook name */
    hookName: string;
    /** Whether the hook executed successfully (exit code 0 or in success list) */
    success: boolean;
    /** Output from the command (stdout) */
    output?: string;
    /** Error output from the command (stderr) */
    stderr?: string;
    /** Error message if the hook failed */
    error?: string;
    /** Execution time in milliseconds */
    duration?: number;
    /** Process exit code (null if killed by signal) */
    exitCode?: number | null;
    /** The hook's execution mode */
    mode?: HookMode;
    /** Outcome based on mode and exit code classification */
    outcome?: HookOutcome;
    /** Whether the workflow should be aborted (for blocking/interactive modes) */
    aborted?: boolean;
}

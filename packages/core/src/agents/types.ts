/**
 * Agent Registry Types
 *
 * Defines the data structures for tracking parallel Claude agents.
 * MVP uses file-based storage; IPC socket planned for #107.
 */

/**
 * Current status of an agent
 */
export type AgentStatus = 'starting' | 'running' | 'waiting' | 'stopped' | 'error';

/**
 * Represents a running Claude agent working on an issue
 */
export interface AgentInstance {
    /** Unique identifier for this agent instance */
    id: string;

    /** GitHub issue number this agent is working on */
    issueNumber: number;

    /** Issue title for display */
    issueTitle: string;

    /** Process ID of the Claude process */
    pid: number;

    /** Dev server port (if known/running) */
    port?: number;

    /** Path to the git worktree */
    worktreePath: string;

    /** Git branch name */
    branch: string;

    /** Current status */
    status: AgentStatus;

    /** ISO timestamp when agent started */
    startedAt: string;

    /** ISO timestamp of last heartbeat (for future use) */
    lastSeen?: string;

    /** Optional error message if status is 'error' */
    error?: string;

    /** Current action from session watcher */
    currentAction?: string;

    /** Whether waiting for user input/approval */
    waitingForInput?: boolean;
}

/**
 * The registry file structure
 */
export interface AgentRegistry {
    /** Schema version for future migrations */
    version: number;

    /** Map of agent ID to instance */
    agents: Record<string, AgentInstance>;

    /** Last modified timestamp */
    updatedAt: string;
}

/**
 * Options for registering a new agent
 */
export interface RegisterAgentOptions {
    issueNumber: number;
    issueTitle: string;
    pid: number;
    worktreePath: string;
    branch: string;
    port?: number;
}

/**
 * Options for updating an agent
 */
export interface UpdateAgentOptions {
    status?: AgentStatus;
    port?: number;
    error?: string;
    /** Current action from session watcher */
    currentAction?: string;
    /** Whether waiting for user input */
    waitingForInput?: boolean;
}

/**
 * Agent summary for display (lightweight)
 */
export interface AgentSummary {
    id: string;
    issueNumber: number;
    issueTitle: string;
    status: AgentStatus;
    port?: number;
    branch: string;
    uptime: string; // Human-readable like "2h 15m"
    /** Current action (from session watcher) */
    currentAction?: string;
    /** Whether waiting for user input/approval */
    waitingForInput?: boolean;
}

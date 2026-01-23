/**
 * Types re-exported from core library.
 *
 * This file maintains backwards compatibility for imports.
 */

export type {
    RepoInfo,
    ProjectItem,
    Project,
    StatusField,
    IssueDetails,
    Collaborator,
    IssueReference,
} from '@bretwardjames/ghp-core';

/**
 * Subagent spawn directive output format.
 * Used by AI assistants to spawn a subagent in the worktree context.
 */
export interface SubagentSpawnDirective {
    action: 'spawn_subagent';
    workingDirectory: string;
    issue: {
        number: number;
        title: string;
        status: string | null;
        url: string;
    };
    branch: string;
    repository: {
        owner: string;
        name: string;
        mainBranch: string;
    };
    memory: {
        namespace: string;
    };
    handoffPrompt: string;
}

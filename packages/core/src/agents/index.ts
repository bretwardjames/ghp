/**
 * Agent Registry Module
 *
 * Tracks parallel Claude agents working on issues.
 */

// Types
export type {
    AgentStatus,
    AgentInstance,
    AgentRegistry,
    AgentSummary,
    RegisterAgentOptions,
    UpdateAgentOptions,
} from './types.js';

// Registry functions
export {
    getRegistryPath,
    loadRegistry,
    saveRegistry,
    registerAgent,
    updateAgent,
    unregisterAgent,
    getAgent,
    getAgentByIssue,
    listAgents,
    getAgentSummaries,
    cleanupStaleAgents,
} from './registry.js';

// Session watcher
export {
    SessionWatcher,
    findSessionFile,
    parseSessionLine,
    formatAction,
    createSessionWatcher,
    checkTmuxForPermission,
} from './session-watcher.js';

export type {
    SessionEvent,
    AgentSessionStatus,
    PermissionPrompt,
} from './session-watcher.js';

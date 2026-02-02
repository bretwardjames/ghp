/**
 * @bretwardjames/ghp-core
 *
 * Shared core library for GitHub Projects tools.
 * Provides authentication-agnostic API access, git utilities, and branch linking.
 *
 * @example Basic usage:
 * ```typescript
 * import { GitHubAPI, detectRepository, BranchLinker } from '@bretwardjames/ghp-core';
 *
 * const api = new GitHubAPI({
 *   tokenProvider: { getToken: async () => process.env.GITHUB_TOKEN ?? null }
 * });
 *
 * await api.authenticate();
 * const repo = await detectRepository();
 * const projects = await api.getProjects(repo);
 * ```
 */

// =============================================================================
// Core API
// =============================================================================

export { GitHubAPI } from './github-api.js';

// =============================================================================
// Branch Linker (stores links in GitHub issue bodies)
// =============================================================================

export {
    BranchLinker,
    parseBranchLink,
    setBranchLinkInBody,
    removeBranchLinkFromBody,
} from './branch-linker.js';

// =============================================================================
// Git Utilities
// =============================================================================

export {
    detectRepository,
    getCurrentBranch,
    hasUncommittedChanges,
    branchExists,
    createBranch,
    checkoutBranch,
    pullLatest,
    fetchOrigin,
    getCommitsBehind,
    getCommitsAhead,
    isGitRepository,
    getRepositoryRoot,
    sanitizeForBranchName,
    generateBranchName,
    extractIssueNumberFromBranch,
    getDefaultBranch,
    getLocalBranches,
    getRemoteBranches,
    getAllBranches,
    // Worktree operations
    createWorktree,
    removeWorktree,
    listWorktrees,
    getWorktreeForBranch,
    worktreeExists,
    generateWorktreePath,
} from './git-utils.js';

export type { WorktreeInfo } from './git-utils.js';

// =============================================================================
// URL Utilities
// =============================================================================

export {
    parseGitHubUrl,
    parseIssueUrl,
    buildIssueUrl,
    buildPullRequestUrl,
    buildRepoUrl,
    buildProjectUrl,
    buildOrgProjectUrl,
} from './url-parser.js';

// =============================================================================
// Settings Sync (bidirectional CLI ↔ VSCode)
// =============================================================================

export {
    // Functions
    normalizeVSCodeSettings,
    toVSCodeSettings,
    computeSettingsDiff,
    hasDifferences,
    resolveConflicts,
    formatConflict,
    getDiffSummary,
    // Resolution helpers
    useCli,
    useVSCode,
    useCustom,
    skip,
    // Constants
    SYNCABLE_KEYS,
    SETTING_DISPLAY_NAMES,
    VSCODE_TO_CLI_MAP,
    CLI_TO_VSCODE_MAP,
    DEFAULT_VALUES,
} from './sync.js';

export type {
    SyncableSettingKey,
    SyncableSettings,
    SettingsSource,
    SettingConflict,
    SettingsDiff,
    ConflictResolution,
    ConflictChoices,
    ResolvedSettings,
} from './sync.js';

// =============================================================================
// GraphQL Queries (for advanced usage)
// =============================================================================

export * as queries from './queries.js';

// =============================================================================
// Claude AI Integration
// =============================================================================

export { ClaudeClient } from './claude/index.js';

export type {
    // Configuration
    ApiKeyProvider,
    ClaudeClientOptions,
    ResolvedClaudeConfig,

    // Streaming (callback-based)
    StreamCallbacks,

    // Streaming (async iterator)
    StreamOptions,
    StreamEvent,
    StreamEventBase,
    StreamTextEvent,
    StreamToolUseStartEvent,
    StreamToolInputDeltaEvent,
    StreamToolUseCompleteEvent,
    StreamMessageCompleteEvent,
    StreamErrorEvent,

    // Tools
    ClaudeTool,
    ToolContext,
    ToolHandler,
    ToolHandlers,

    // Messages
    Message,
    ContentBlock,
    TokenUsage,
    ClaudeResult,

    // High-level API options
    GeneratePRDescriptionOptions,
    PlanEpicOptions,
    PlanEpicResult,
    ExpandIssueOptions,
    ExpandedIssue,
} from './claude/index.js';

export {
    GHP_TOOLS,
    getTools,
    TOOL_NAMES,
} from './claude/index.js';

export * as claudePrompts from './claude/prompts/index.js';

// =============================================================================
// Project Conventions
// =============================================================================

export {
    loadProjectConventions,
    buildConventionsContext,
    getIssueReferenceText,
} from './conventions.js';

export type { ProjectConventions } from './conventions.js';

// =============================================================================
// Types
// =============================================================================

// =============================================================================
// Agent Registry (parallel agent tracking)
// =============================================================================

export {
    // Registry functions
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
    // Session watcher
    SessionWatcher,
    findSessionFile,
    parseSessionLine,
    formatAction,
    createSessionWatcher,
    checkTmuxForPermission,
} from './agents/index.js';

export type {
    AgentStatus,
    AgentInstance,
    AgentRegistry,
    AgentSummary,
    RegisterAgentOptions,
    UpdateAgentOptions,
    SessionEvent,
    AgentSessionStatus,
    PermissionPrompt,
} from './agents/index.js';

// =============================================================================
// Types
// =============================================================================

export type {
    // Authentication & Configuration
    TokenProvider,
    GitHubAPIOptions,
    AuthError,

    // Git
    GitOptions,
    RepoInfo,

    // Normalized Types (simplified)
    Project,
    ProjectItem,
    StatusField,
    IssueDetails,
    Collaborator,
    IssueReference,
    LabelInfo,
    FieldInfo,
    AssigneeInfo,

    // Raw GraphQL Types
    ProjectV2,
    ProjectV2Field,
    ProjectV2View,
    ProjectWithViews,
    ProjectV2Item,
    ProjectItemContent,
    FieldValueConnection,
    FieldValue,
    SingleSelectFieldValue,
    TextFieldValue,
    DateFieldValue,
    NumberFieldValue,
    IterationFieldValue,
    ProjectsQueryResponse,
    ProjectItemsQueryResponse,

    // Configuration
    ProjectConfig,

    // Issue Relationships (Parent/Child)
    RelatedIssue,
    IssueRelationships,

    // Blocking Relationships
    BlockingIssue,
    BlockingRelationships,
} from './types.js';

// =============================================================================
// Dashboard (branch overview)
// =============================================================================

export {
    getCurrentBranch as getDashboardCurrentBranch, // Alias for backward compat
    getDefaultBaseBranch,
    getCommitHistory,
    getDiffStats,
    getFullDiff,
    getChangedFiles,
    gatherDashboardData,
    // Hook execution
    getGitHubRepo,
    executeHook,
    executeAllHooks,
} from './dashboard/index.js';

export type {
    DiffStats,
    FileChange,
    Commit,
    BranchDashboardData,
    DashboardOptions,
    HookExecutionResult,
} from './dashboard/index.js';

// Dashboard Hooks
export {
    getHooksConfigPath,
    loadHooksConfig,
    saveHooksConfig,
    getHooks,
    getEnabledHooks,
    getHook,
    addHook,
    updateHook,
    removeHook,
    enableHook,
    disableHook,
    getHooksByCategory,
} from './dashboard/hooks.js';

export type {
    DashboardHook,
    HooksConfig,
    HookItem,
    HookResponse,
} from './dashboard/hooks.js';

// =============================================================================
// Workflows (Centralized Operations + Hook Firing)
// =============================================================================

export {
    // Issue workflows
    createIssueWorkflow,
    startIssueWorkflow,
    // PR workflows
    createPRWorkflow,
    // Worktree workflows
    createWorktreeWorkflow,
    removeWorktreeWorkflow,
} from './workflows/index.js';

export type {
    // Common types
    WorkflowResult,
    IssueInfo as WorkflowIssueInfo,
    WorktreeInfo as WorkflowWorktreeInfo,
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
} from './workflows/index.js';

// =============================================================================
// Event Hooks System
// =============================================================================

export {
    // Registry
    getEventHooksConfigPath,
    loadEventHooksConfig,
    saveEventHooksConfig,
    getEventHooks,
    getEnabledEventHooks,
    getEventHook,
    getHooksForEvent,
    addEventHook,
    updateEventHook,
    removeEventHook,
    enableEventHook,
    disableEventHook,
    getValidEventTypes,
    // Executor
    substituteTemplateVariables,
    executeEventHook,
    executeHooksForEvent,
    hasHooksForEvent,
} from './plugins/index.js';

export type {
    EventType,
    EventHook,
    EventHooksConfig,
    BaseEventPayload,
    IssueCreatedPayload,
    IssueStartedPayload,
    PrCreatedPayload,
    PrMergedPayload,
    WorktreeCreatedPayload,
    WorktreeRemovedPayload,
    EventPayload,
    HookResult,
    HookExecutionOptions,
} from './plugins/index.js';

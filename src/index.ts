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
    getDefaultBranch,
    getLocalBranches,
    getRemoteBranches,
    getAllBranches,
} from './git-utils.js';

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
} from './types.js';

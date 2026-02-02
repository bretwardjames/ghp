/**
 * Core types for GitHub Projects V2 API
 *
 * This module provides both:
 * - Raw GraphQL response types (ProjectV2, ProjectV2Item, etc.) for full API access
 * - Normalized types (ProjectItem, Project) for simplified usage
 */

// =============================================================================
// Authentication & Configuration Interfaces
// =============================================================================

/**
 * Interface for providing authentication tokens.
 * Implement this to integrate with different auth systems (CLI, VSCode, etc.)
 */
export interface TokenProvider {
    getToken(): Promise<string | null>;
}

/**
 * Configuration for retry behavior on transient API failures
 */
export interface RetryConfig {
    /** Maximum number of retry attempts (default: 3) */
    maxRetries: number;
    /** Base delay in milliseconds (default: 1000) */
    baseDelayMs: number;
    /** Maximum delay in milliseconds (default: 30000) */
    maxDelayMs: number;
    /** Optional callback for retry events (logging, metrics) */
    onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Options for GitHubAPI constructor
 */
export interface GitHubAPIOptions {
    /** Provider for authentication tokens */
    tokenProvider: TokenProvider;
    /** Callback for authentication errors (scope issues, SSO, etc.) */
    onAuthError?: (error: AuthError) => void;
    /** Configuration for retry behavior on transient failures (optional) */
    retryConfig?: Partial<RetryConfig>;
}

/**
 * Authentication error with details about what went wrong
 */
export interface AuthError extends Error {
    type: 'INSUFFICIENT_SCOPES' | 'SSO_REQUIRED' | 'TOKEN_EXPIRED' | 'UNKNOWN';
    requiredScopes?: string[];
    ssoUrl?: string;
}

// =============================================================================
// Git Utilities Options
// =============================================================================

/**
 * Options for git operations
 */
export interface GitOptions {
    /** Working directory for git commands. Defaults to process.cwd() */
    cwd?: string;
}

// =============================================================================
// Repository Information
// =============================================================================

/**
 * Information about a GitHub repository
 */
export interface RepoInfo {
    owner: string;
    name: string;
    fullName: string;
}

// =============================================================================
// Normalized Types (simplified for common use cases)
// =============================================================================

/**
 * A simplified project representation
 */
export interface Project {
    id: string;
    title: string;
    number: number;
    url: string;
}

/**
 * A normalized project item for display purposes
 */
export interface ProjectItem {
    id: string;
    title: string;
    number: number | null;
    type: 'issue' | 'pull_request' | 'draft';
    issueType: string | null;
    status: string | null;
    statusIndex: number;
    state: 'open' | 'closed' | 'merged' | null;
    assignees: string[];
    labels: Array<{ name: string; color: string }>;
    repository: string | null;
    url: string | null;
    projectId: string;
    projectTitle: string;
    fields: Record<string, string>;
    // Parent/child relationships (issues only)
    parent: RelatedIssue | null;
    subIssues: RelatedIssue[];
    // Blocking relationships (issues only)
    blockedBy: BlockingIssue[];
    blocking: BlockingIssue[];
}

/**
 * Status field information for a project
 */
export interface StatusField {
    fieldId: string;
    options: Array<{
        id: string;
        name: string;
    }>;
}

/**
 * Full issue details including body and comments
 */
export interface IssueDetails {
    title: string;
    body: string;
    state: string;
    type: 'issue' | 'pull_request';
    createdAt: string;
    author: string;
    labels: Array<{ name: string; color: string }>;
    comments: Array<{
        author: string;
        body: string;
        createdAt: string;
    }>;
    totalComments: number;
}

/**
 * A repository collaborator
 */
export interface Collaborator {
    login: string;
    name: string | null;
}

/**
 * An issue reference (for autocomplete)
 */
export interface IssueReference {
    number: number;
    title: string;
    state: string;
}

// =============================================================================
// Raw GraphQL Response Types (for full API access)
// =============================================================================

/**
 * Raw GitHub Project V2 from GraphQL
 */
export interface ProjectV2 {
    id: string;
    title: string;
    number: number;
    url: string;
    closed?: boolean;
    shortDescription?: string | null;
    owner?: {
        login: string;
        __typename: 'User' | 'Organization';
    };
    fields?: {
        nodes: ProjectV2Field[];
    };
}

/**
 * A field in a GitHub Project V2
 */
export interface ProjectV2Field {
    __typename: string;
    id: string;
    name: string;
    options?: Array<{
        id: string;
        name: string;
        color?: string;
    }>;
}

/**
 * A saved view in a GitHub Project (Board, Table, or Roadmap layout)
 */
export interface ProjectV2View {
    id: string;
    name: string;
    number: number;
    layout: 'BOARD_LAYOUT' | 'TABLE_LAYOUT' | 'ROADMAP_LAYOUT';
    groupByFields?: {
        nodes: Array<{
            __typename: string;
            id: string;
            name: string;
            options?: Array<{
                id: string;
                name: string;
                color?: string;
            }>;
        }>;
    };
    verticalGroupByFields?: {
        nodes: Array<{
            __typename: string;
            id: string;
            name: string;
        }>;
    };
    sortByFields?: {
        nodes: Array<{
            __typename: string;
            field: {
                id: string;
                name: string;
            };
            direction: 'ASC' | 'DESC';
        }>;
    };
    filter?: string | null;
}

/**
 * Extended project info with views and fields
 */
export interface ProjectWithViews extends ProjectV2 {
    views: ProjectV2View[];
    fields: {
        nodes: ProjectV2Field[];
    };
}

/**
 * Raw project item from GraphQL
 */
export interface ProjectV2Item {
    id: string;
    type: 'ISSUE' | 'PULL_REQUEST' | 'DRAFT_ISSUE';
    content: ProjectItemContent | null;
    fieldValues: FieldValueConnection;
}

/**
 * Content of a project item (Issue, PR, or Draft)
 */
export interface ProjectItemContent {
    __typename: 'Issue' | 'PullRequest' | 'DraftIssue';
    title: string;
    number?: number;
    url?: string;
    state?: 'OPEN' | 'CLOSED' | 'MERGED';
    merged?: boolean;
    issueType?: { name: string } | null;
    repository?: {
        name: string;
        owner?: {
            login: string;
        };
    };
    assignees?: {
        nodes: Array<{
            login: string;
            avatarUrl?: string;
        }>;
    };
    labels?: {
        nodes: Array<{
            name: string;
            color: string;
        }>;
    };
}

/**
 * Connection wrapper for field values
 */
export interface FieldValueConnection {
    nodes: FieldValue[];
}

/**
 * Union type for all field value types
 */
export type FieldValue =
    | SingleSelectFieldValue
    | TextFieldValue
    | DateFieldValue
    | NumberFieldValue
    | IterationFieldValue;

export interface SingleSelectFieldValue {
    __typename: 'ProjectV2ItemFieldSingleSelectValue';
    name: string;
    field: { name: string };
}

export interface TextFieldValue {
    __typename: 'ProjectV2ItemFieldTextValue';
    text: string;
    field: { name: string };
}

export interface DateFieldValue {
    __typename: 'ProjectV2ItemFieldDateValue';
    date: string;
    field: { name: string };
}

export interface NumberFieldValue {
    __typename: 'ProjectV2ItemFieldNumberValue';
    number: number;
    field: { name: string };
}

export interface IterationFieldValue {
    __typename: 'ProjectV2ItemFieldIterationValue';
    title: string;
    startDate: string;
    duration: number;
    field: { name: string };
}

// =============================================================================
// GraphQL Response Types
// =============================================================================

export interface ProjectsQueryResponse {
    viewer: {
        login: string;
        projectsV2: {
            nodes: ProjectV2[];
        };
    };
}

export interface ProjectItemsQueryResponse {
    node: {
        items: {
            pageInfo: {
                hasNextPage: boolean;
                endCursor: string | null;
            };
            nodes: ProjectV2Item[];
        };
    };
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for connecting to a GitHub Project
 */
export interface ProjectConfig {
    owner: string;
    projectNumber: number;
    type: 'user' | 'organization';
}

/**
 * Label information with optional color
 */
export interface LabelInfo {
    name: string;
    color: string | null;
}

/**
 * Field information with value and color
 */
export interface FieldInfo {
    value: string;
    color: string | null;
}

/**
 * Assignee information
 */
export interface AssigneeInfo {
    login: string;
    avatarUrl: string | null;
}

// =============================================================================
// Issue Relationships (Parent/Child)
// =============================================================================

/**
 * A related issue reference (parent or sub-issue)
 */
export interface RelatedIssue {
    id: string;
    number: number;
    title: string;
    state: string;
}

/**
 * Issue relationships including parent, sub-issues, and blocking relationships
 */
export interface IssueRelationships {
    id: string;
    number: number;
    title: string;
    parent: RelatedIssue | null;
    subIssues: RelatedIssue[];
    /** Issues that are blocking this issue (this issue is blocked by these) */
    blockedBy: BlockingIssue[];
    /** Issues that this issue is blocking (these are blocked by this issue) */
    blocking: BlockingIssue[];
}

// =============================================================================
// Blocking Relationships
// =============================================================================

/**
 * A blocking issue reference (issue that blocks or is blocked by another)
 */
export interface BlockingIssue {
    id: string;
    number: number;
    title: string;
    state: string;
}

/**
 * Blocking relationships for an issue
 */
export interface BlockingRelationships {
    /** Issues that are blocking this issue (this issue is blocked by these) */
    blockedBy: BlockingIssue[];
    /** Issues that this issue is blocking (these are blocked by this issue) */
    blocking: BlockingIssue[];
}

/**
 * Types for GitHub Projects V2 API responses
 *
 * Re-exports common types from @bretwardjames/ghp-core
 * and defines VSCode extension-specific types.
 */

// Re-export common types from core library
export type {
    // Raw GraphQL types
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

    // Utility types
    ProjectConfig,
    LabelInfo,
    FieldInfo,
    AssigneeInfo,

    // Issue Relationships (Parent/Child)
    RelatedIssue,
    IssueRelationships,
} from '@bretwardjames/ghp-core';

// Alias for backwards compatibility
export { ProjectV2Field as ProjectField } from '@bretwardjames/ghp-core';

// =============================================================================
// VSCode Extension-Specific Types
// =============================================================================

/**
 * Extended project info with available status values for mapping
 * @deprecated Use ProjectWithViews instead
 */
export interface ProjectWithFields {
    id: string;
    title: string;
    number: number;
    url: string;
    closed?: boolean;
    shortDescription?: string | null;
    statusField: {
        __typename: string;
        id: string;
        name: string;
        options?: Array<{ id: string; name: string; color?: string }>;
    } | null;
    statusOptions: string[];
}

/**
 * Response type for fetching user's project items
 */
export interface UserProjectItemsResponse {
    viewer: {
        login: string;
    };
    node: {
        items: {
            pageInfo: {
                hasNextPage: boolean;
                endCursor: string | null;
            };
            nodes: import('@bretwardjames/ghp-core').ProjectV2Item[];
        };
    };
}

/**
 * Parsed/normalized project item for display in the tree view
 * Note: Uses Map for fields (vs Record in CLI) for richer VSCode rendering
 */
export interface NormalizedProjectItem {
    id: string;
    title: string;
    type: 'issue' | 'pr' | 'draft';
    status: string | null;
    url: string | null;
    number: number | null;
    repository: string | null;
    assignees: import('@bretwardjames/ghp-core').AssigneeInfo[];
    labels: import('@bretwardjames/ghp-core').LabelInfo[];
    state: 'open' | 'closed' | 'merged' | null;
    fields: Map<string, import('@bretwardjames/ghp-core').FieldInfo>;
    issueType: string | null;
}

/**
 * User-defined mapping of project statuses to normalized display categories
 */
export interface StatusMapping {
    /** The normalized category name shown in the sidebar (e.g., "In Progress") */
    displayName: string;
    /** Sort order for this category (lower = higher in list) */
    order: number;
    /** Icon to show (VS Code ThemeIcon name) */
    icon?: string;
    /** Color for the icon */
    color?: string;
}

/**
 * Configuration for a single project's status mapping
 */
export interface ProjectStatusConfig {
    projectId: string;
    projectTitle: string;
    enabled: boolean;
    /** Maps original status values to normalized display names */
    statusMappings: Record<string, string>;
}

/**
 * Full extension configuration stored in workspace/user settings
 */
export interface GHProjectsConfig {
    /** Normalized status categories and their display settings */
    statusCategories: Record<string, StatusMapping>;
    /** Per-project configuration */
    projects: Record<string, ProjectStatusConfig>;
}

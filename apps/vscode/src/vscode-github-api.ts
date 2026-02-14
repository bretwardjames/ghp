/**
 * VSCode-specific GitHub API wrapper
 *
 * Extends core's GitHubAPI with:
 * - VSCode authentication provider integration
 * - Signature adapters for VSCode's (owner, repo) pattern
 * - VSCode-specific convenience methods
 *
 * @example
 * ```typescript
 * const api = new VSCodeGitHubAPI();
 * await api.authenticate();
 * const projects = await api.getMyProjects();
 * ```
 */

import * as vscode from 'vscode';
import {
    GitHubAPI,
    type TokenProvider,
    type RepoInfo,
    type Project,
    type ProjectItem,
    type StatusField,
    type IssueDetails,
    type Collaborator,
    type IssueReference,
    type IssueRelationships,
    type ProjectV2,
    type ProjectV2View,
    type ProjectV2Field,
    type ProjectWithViews,
    queries,
} from '@bretwardjames/ghp-core';

import type {
    NormalizedProjectItem,
    ProjectWithFields,
    ProjectConfig,
    ProjectField,
} from './types';
import type { AssigneeInfo, FieldInfo, LabelInfo } from '@bretwardjames/ghp-core';

// =============================================================================
// Type Conversion Utilities
// =============================================================================

/**
 * Convert core's ProjectItem to VSCode's NormalizedProjectItem
 */
function toNormalizedItem(item: ProjectItem): NormalizedProjectItem {
    // Convert type: 'pull_request' -> 'pr'
    const type: 'issue' | 'pr' | 'draft' =
        item.type === 'pull_request' ? 'pr' : item.type;

    // Convert assignees: string[] -> AssigneeInfo[]
    const assignees: AssigneeInfo[] = item.assignees.map(login => ({
        login,
        avatarUrl: null,
    }));

    // Convert labels to include null color support
    const labels: LabelInfo[] = item.labels.map(l => ({
        name: l.name,
        color: l.color || null,
    }));

    // Convert fields: Record<string, string> -> Map<string, FieldInfo>
    const fields = new Map<string, FieldInfo>();
    for (const [key, value] of Object.entries(item.fields)) {
        fields.set(key.toLowerCase(), { value, color: null });
    }

    return {
        id: item.id,
        title: item.title,
        type,
        status: item.status,
        url: item.url,
        number: item.number,
        repository: item.repository,
        assignees,
        labels,
        state: item.state,
        fields,
        issueType: item.issueType,
    };
}

// =============================================================================
// VSCode Token Provider
// =============================================================================

/**
 * Token provider that uses VSCode's built-in GitHub authentication
 */
class VSCodeTokenProvider implements TokenProvider {
    private cachedToken: string | null = null;

    async getToken(): Promise<string | null> {
        try {
            const session = await vscode.authentication.getSession('github', ['project', 'repo'], {
                createIfNone: false,
            });
            this.cachedToken = session?.accessToken ?? null;
            return this.cachedToken;
        } catch {
            return this.cachedToken;
        }
    }

    /**
     * Get token with option to create session if none exists
     */
    async getTokenWithPrompt(): Promise<string | null> {
        try {
            const session = await vscode.authentication.getSession('github', ['project', 'repo'], {
                createIfNone: true,
            });
            this.cachedToken = session?.accessToken ?? null;
            return this.cachedToken;
        } catch (error) {
            console.error('GitHub authentication failed:', error);
            return null;
        }
    }
}

// =============================================================================
// Helper: Convert (owner, repo) to RepoInfo
// =============================================================================

function toRepoInfo(owner: string, repo: string): RepoInfo {
    return {
        owner,
        name: repo,
        fullName: `${owner}/${repo}`,
    };
}

// =============================================================================
// VSCode GitHub API
// =============================================================================

/**
 * GitHub API client for VSCode extension
 *
 * Extends core's GitHubAPI with VSCode-specific features:
 * - Uses VSCode's authentication provider
 * - Provides (owner, repo) signature adapters
 * - Adds convenience methods for common VSCode workflows
 */
export class VSCodeGitHubAPI extends GitHubAPI {
    private vscodeTokenProvider: VSCodeTokenProvider;
    // Separate graphql client for VSCode-specific methods (doesn't shadow parent's private member)
    private _vscodeGraphqlClient: ReturnType<typeof import('@octokit/graphql').graphql.defaults> | null = null;

    constructor() {
        const tokenProvider = new VSCodeTokenProvider();
        super({
            tokenProvider,
            onAuthError: (error) => {
                const message = error.type === 'SSO_REQUIRED'
                    ? `SSO Authorization Required: Visit github.com/settings/connections/applications to authorize.`
                    : error.message;
                vscode.window.showErrorMessage(message);
            },
        });
        this.vscodeTokenProvider = tokenProvider;
    }

    /**
     * Authenticate with GitHub using VSCode's auth provider
     * Prompts user to sign in if not already authenticated
     */
    override async authenticate(): Promise<boolean> {
        const token = await this.vscodeTokenProvider.getTokenWithPrompt();
        if (!token) {
            return false;
        }

        // Call parent authenticate to set up graphql clients
        const result = await super.authenticate();

        // Also set up local graphql client for VSCode-specific methods
        if (result) {
            const { graphql } = await import('@octokit/graphql');
            this._vscodeGraphqlClient = graphql.defaults({
                headers: {
                    authorization: `token ${token}`,
                },
            });
        }

        return result;
    }

    /**
     * Get the raw GraphQL client for advanced usage
     */
    getGraphQLClient() {
        return this._vscodeGraphqlClient;
    }

    // =========================================================================
    // VSCode-compatible overrides (return VSCode types)
    // =========================================================================

    /**
     * Get project items with VSCode-compatible options and return type
     * Overrides core's method to return NormalizedProjectItem[]
     */
    async getProjectItemsNormalized(
        projectId: string,
        options: {
            assignedToMe?: boolean;
            statusFieldName?: string;
        } = {}
    ): Promise<NormalizedProjectItem[]> {
        // Get items from core (uses project title for backwards compat)
        const coreItems = await super.getProjectItems(projectId, 'Project');

        // Convert to VSCode normalized format
        let normalized = coreItems.map(toNormalizedItem);

        // Filter by assignee if requested
        if (options.assignedToMe && this.username) {
            normalized = normalized.filter(
                (item) =>
                    item.assignees.some((a) => a.login === this.username) ||
                    item.type === 'draft'
            );
        }

        return normalized;
    }

    /**
     * Get project fields with VSCode-expected return type
     */
    async getProjectFieldsExtended(projectId: string): Promise<Array<{
        id: string;
        name: string;
        options: Array<{ id: string; name: string }>;
    }>> {
        const fields = await super.getProjectFields(projectId);
        return fields
            .filter(f => f.options) // Only return fields with options (single select)
            .map(f => ({
                id: f.id,
                name: f.name,
                options: f.options || [],
            }));
    }

    /**
     * Update any single-select field value on a project item
     */
    async updateItemField(
        projectId: string,
        itemId: string,
        fieldId: string,
        optionId: string
    ): Promise<boolean> {
        const result = await this.setFieldValue(projectId, itemId, fieldId, {
            singleSelectOptionId: optionId,
        });
        return result.success;
    }

    /**
     * Find status field and option from a ProjectWithViews
     */
    findStatusFieldAndOptionFromProject(
        project: ProjectWithViews,
        targetStatusName: string
    ): { fieldId: string; optionId: string } | null {
        const statusField = project.fields.nodes.find(
            (f) =>
                f.__typename === 'ProjectV2SingleSelectField' &&
                (f.name.toLowerCase() === 'status' ||
                    f.name.toLowerCase() === 'state' ||
                    f.name.toLowerCase() === 'stage')
        );

        if (!statusField || !statusField.options) {
            return null;
        }

        const option = statusField.options.find(
            (o) => o.name.toLowerCase() === targetStatusName.toLowerCase()
        );

        if (!option) {
            return null;
        }

        return {
            fieldId: statusField.id,
            optionId: option.id,
        };
    }

    // =========================================================================
    // Methods NOT in Core - VSCode-specific implementations
    // =========================================================================

    /**
     * Fetch all projects accessible to the current user (not repo-linked)
     */
    async getMyProjects(): Promise<ProjectV2[]> {
        if (!this._vscodeGraphqlClient) {
            throw new Error('Not authenticated');
        }

        const query = `
            query {
                viewer {
                    projectsV2(first: 20) {
                        nodes {
                            id
                            title
                            number
                            url
                            closed
                            shortDescription
                        }
                    }
                }
            }
        `;

        const response = await this._vscodeGraphqlClient<{
            viewer: { projectsV2: { nodes: ProjectV2[] } };
        }>(query);

        return response.viewer.projectsV2.nodes.filter((p) => !p.closed);
    }

    /**
     * Fetch a project by owner and number
     */
    async getProject(config: ProjectConfig): Promise<ProjectV2 | null> {
        if (!this._vscodeGraphqlClient) {
            throw new Error('Not authenticated');
        }

        const ownerQuery = config.type === 'user' ? 'user' : 'organization';
        const query = `
            query($owner: String!, $number: Int!) {
                ${ownerQuery}(login: $owner) {
                    projectV2(number: $number) {
                        id
                        title
                        number
                        url
                        closed
                        shortDescription
                    }
                }
            }
        `;

        try {
            const response = await this._vscodeGraphqlClient<{
                user?: { projectV2: ProjectV2 };
                organization?: { projectV2: ProjectV2 };
            }>(query, {
                owner: config.owner,
                number: config.projectNumber,
            });

            return response.user?.projectV2 || response.organization?.projectV2 || null;
        } catch (error) {
            console.error('Failed to fetch project:', error);
            return null;
        }
    }

    /**
     * Fetch projects linked to a repository WITH their views configuration
     * Accepts either RepoInfo object or separate owner/repo strings
     */
    async getProjectsWithViews(repoOrOwner: RepoInfo | string, repoName?: string): Promise<ProjectWithViews[]> {
        if (!this._vscodeGraphqlClient) {
            throw new Error('Not authenticated');
        }

        // Support both (RepoInfo) and (owner, repo) signatures
        const owner = typeof repoOrOwner === 'string' ? repoOrOwner : repoOrOwner.owner;
        const repo = typeof repoOrOwner === 'string' ? repoName! : repoOrOwner.name;

        const projects: ProjectWithViews[] = [];

        const projectFragment = `
            id
            title
            number
            url
            closed
            shortDescription
            owner {
                ... on User {
                    login
                    __typename
                }
                ... on Organization {
                    login
                    __typename
                }
            }
            views(first: 20) {
                nodes {
                    id
                    name
                    number
                    layout
                    filter
                }
            }
            fields(first: 30) {
                nodes {
                    ... on ProjectV2Field {
                        __typename
                        id
                        name
                    }
                    ... on ProjectV2SingleSelectField {
                        __typename
                        id
                        name
                        options {
                            id
                            name
                            color
                        }
                    }
                    ... on ProjectV2IterationField {
                        __typename
                        id
                        name
                    }
                }
            }
        `;

        // Query repository-linked projects
        const repoQuery = `
            query($owner: String!, $name: String!) {
                repository(owner: $owner, name: $name) {
                    projectsV2(first: 20) {
                        nodes {
                            ${projectFragment}
                        }
                    }
                }
            }
        `;

        try {
            const repoResponse = await this._vscodeGraphqlClient<{
                repository: {
                    projectsV2: {
                        nodes: Array<ProjectV2 & {
                            views: { nodes: ProjectV2View[] };
                            fields: { nodes: ProjectV2Field[] };
                        }>;
                    };
                };
            }>(repoQuery, { owner, name: repo });

            for (const project of repoResponse.repository.projectsV2.nodes) {
                if (!project.closed) {
                    projects.push({
                        ...project,
                        views: project.views.nodes,
                        fields: project.fields,
                    });
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('SSO') || errorMessage.includes('SAML')) {
                throw new Error(
                    `SSO Authorization Required: Your OAuth token needs to be authorized for the ${owner} organization.`
                );
            }
            throw new Error(`Failed to access projects for ${owner}/${repo}: ${errorMessage}`);
        }

        // Also try organization-level projects
        try {
            const orgQuery = `
                query($owner: String!) {
                    organization(login: $owner) {
                        projectsV2(first: 20) {
                            nodes {
                                ${projectFragment}
                            }
                        }
                    }
                }
            `;

            const orgResponse = await this._vscodeGraphqlClient<{
                organization: {
                    projectsV2: {
                        nodes: Array<ProjectV2 & {
                            views: { nodes: ProjectV2View[] };
                            fields: { nodes: ProjectV2Field[] };
                        }>;
                    };
                };
            }>(orgQuery, { owner });

            for (const project of orgResponse.organization.projectsV2.nodes) {
                if (!project.closed && !projects.some((p) => p.id === project.id)) {
                    projects.push({
                        ...project,
                        views: project.views.nodes,
                        fields: project.fields,
                    });
                }
            }
        } catch {
            // Owner is not an org or no access - that's fine
        }

        return projects;
    }

    /**
     * Find a PR associated with an issue
     */
    /**
     * Find a PR associated with an issue
     * Supports both (item) and (owner, repo, issueNumber) signatures
     */
    async findPRForIssue(
        itemOrOwner: NormalizedProjectItem | string,
        repo?: string,
        issueNumber?: number
    ): Promise<{ state: 'open' | 'closed'; merged: boolean; url: string } | null> {
        if (!this._vscodeGraphqlClient) {
            return null;
        }

        let owner: string;
        let repoName: string;
        let number: number;

        if (typeof itemOrOwner === 'string') {
            // Called with (owner, repo, issueNumber)
            owner = itemOrOwner;
            repoName = repo!;
            number = issueNumber!;
        } else {
            // Called with (item) - OLD VSCode signature
            const item = itemOrOwner;
            if (!item.repository || !item.number) {
                return null;
            }
            const [o, r] = item.repository.split('/');
            if (!o || !r) {
                return null;
            }
            owner = o;
            repoName = r;
            number = item.number;
        }

        const searchQuery = `type:pr repo:${owner}/${repoName} in:body #${number}`;

        try {
            const query = `
                query($searchQuery: String!) {
                    search(query: $searchQuery, type: ISSUE, first: 5) {
                        nodes {
                            ... on PullRequest {
                                __typename
                                state
                                merged
                                url
                                body
                            }
                        }
                    }
                }
            `;

            const response = await this._vscodeGraphqlClient<{
                search: {
                    nodes: Array<{
                        __typename?: string;
                        state?: string;
                        merged?: boolean;
                        url?: string;
                        body?: string;
                    }>;
                };
            }>(query, { searchQuery });

            const prs = response.search.nodes.filter(
                (n) => n.__typename === 'PullRequest' && n.body?.includes(`#${number}`)
            );

            if (prs.length === 0) {
                return null;
            }

            const merged = prs.find((pr) => pr.merged);
            const open = prs.find((pr) => pr.state === 'OPEN');
            const pr = merged || open || prs[0];

            return {
                state: pr.state === 'OPEN' ? 'open' : 'closed',
                merged: pr.merged || false,
                url: pr.url || '',
            };
        } catch (error) {
            console.error('Failed to find PR for issue:', error);
            return null;
        }
    }

    /**
     * Get repository node ID
     */
    async getRepositoryId(owner: string, repo: string): Promise<string | null> {
        if (!this._vscodeGraphqlClient) {
            return null;
        }

        try {
            const response = await this._vscodeGraphqlClient<{
                repository: { id: string };
            }>(`
                query($owner: String!, $repo: String!) {
                    repository(owner: $owner, name: $repo) {
                        id
                    }
                }
            `, { owner, repo });

            return response.repository.id;
        } catch (error) {
            console.error('Failed to get repository ID:', error);
            return null;
        }
    }

    /**
     * Update item status by name (convenience method)
     */
    async updateItemStatusByName(
        projectId: string,
        itemId: string,
        statusName: string
    ): Promise<boolean> {
        const statusField = await this.getStatusField(projectId);
        if (!statusField) {
            console.error('Status field not found in project');
            return false;
        }

        const targetOption = statusField.options.find(
            (o) => o.name.toLowerCase() === statusName.toLowerCase()
        );

        if (!targetOption) {
            console.error(`Status option "${statusName}" not found`);
            return false;
        }

        return this.updateItemStatus(projectId, itemId, statusField.fieldId, targetOption.id);
    }

    /**
     * Get available status options for a project
     */
    async getProjectStatusOptions(projectId: string): Promise<string[]> {
        const statusField = await this.getStatusField(projectId);
        return statusField?.options.map((o) => o.name) || [];
    }

    /**
     * Get an issue's body directly
     */
    async getIssueBody(owner: string, repo: string, issueNumber: number): Promise<string | null> {
        const details = await this.getIssueDetails(toRepoInfo(owner, repo), issueNumber);
        return details?.body ?? null;
    }

    /**
     * Transfer the active label from any other issues to the specified issue
     */
    async transferActiveLabel(
        owner: string,
        repo: string,
        targetIssueNumber: number
    ): Promise<boolean> {
        const labelName = this.getActiveLabelName();
        const repoInfo = toRepoInfo(owner, repo);

        // Ensure the label exists
        await this.ensureLabel(repoInfo, labelName, '1d76db');

        // Find other issues with this label
        const issuesWithLabel = await this.findIssuesWithLabel(repoInfo, labelName);

        // Remove label from other issues
        for (const issueNum of issuesWithLabel) {
            if (issueNum !== targetIssueNumber) {
                await this.removeLabelFromIssue(repoInfo, issueNum, labelName);
            }
        }

        // Add label to target issue
        return this.addLabelToIssue(repoInfo, targetIssueNumber, labelName);
    }

    /**
     * Find status field and option IDs by name
     * Supports both (projectId, statusName) and (project, statusName)
     */
    findStatusFieldAndOption(
        projectIdOrProject: string | ProjectWithViews,
        targetStatusName: string
    ): { fieldId: string; optionId: string } | null {
        // If passed a ProjectWithViews, use synchronous lookup
        if (typeof projectIdOrProject !== 'string') {
            return this.findStatusFieldAndOptionFromProject(projectIdOrProject, targetStatusName);
        }

        // For projectId string, this would need to be async
        // But old code expects sync - so we can't support this case properly
        // This should not be called with just projectId in the VSCode extension
        console.warn('findStatusFieldAndOption called with projectId - use findStatusFieldAndOptionAsync instead');
        return null;
    }

    /**
     * Async version for when you only have projectId
     */
    async findStatusFieldAndOptionAsync(
        projectId: string,
        targetStatusName: string
    ): Promise<{ fieldId: string; optionId: string } | null> {
        const statusField = await this.getStatusField(projectId);
        if (!statusField) {
            return null;
        }

        const option = statusField.options.find(
            (o) => o.name.toLowerCase() === targetStatusName.toLowerCase()
        );

        if (!option) {
            return null;
        }

        return {
            fieldId: statusField.fieldId,
            optionId: option.id,
        };
    }

    /**
     * Update issue body - OLD signature (owner, repo, issueNumber, body)
     */
    async updateIssueBody(
        ownerOrRepo: string | RepoInfo,
        repoOrIssueNumber: string | number,
        issueNumberOrBody: number | string,
        body?: string
    ): Promise<boolean> {
        if (typeof ownerOrRepo === 'string' && typeof repoOrIssueNumber === 'string') {
            // Called with (owner, repo, issueNumber, body)
            return super.updateIssueBody(
                toRepoInfo(ownerOrRepo, repoOrIssueNumber),
                issueNumberOrBody as number,
                body!
            );
        }
        // Called with (RepoInfo, issueNumber, body)
        return super.updateIssueBody(
            ownerOrRepo as RepoInfo,
            repoOrIssueNumber as number,
            issueNumberOrBody as string
        );
    }

    /**
     * Update assignees - OLD signature (owner, repo, issueNumber, assignees, itemType)
     */
    async updateAssignees(
        ownerOrRepo: string | RepoInfo,
        repoOrIssueNumber: string | number,
        issueNumberOrAssignees: number | string[],
        assigneesOrItemType?: string[] | 'issue' | 'pr',
        itemType?: 'issue' | 'pr'
    ): Promise<boolean> {
        if (typeof ownerOrRepo === 'string' && typeof repoOrIssueNumber === 'string') {
            // Called with (owner, repo, issueNumber, assignees, itemType)
            return super.updateAssignees(
                toRepoInfo(ownerOrRepo, repoOrIssueNumber),
                issueNumberOrAssignees as number,
                assigneesOrItemType as string[]
            );
        }
        // Called with (RepoInfo, issueNumber, assignees)
        return super.updateAssignees(
            ownerOrRepo as RepoInfo,
            repoOrIssueNumber as number,
            issueNumberOrAssignees as string[]
        );
    }

    /**
     * Create issue - OLD signature (owner, repo, title, body, options)
     */
    async createIssue(
        ownerOrRepo: string | RepoInfo,
        repoOrTitle: string,
        titleOrBody: string,
        bodyOrOptions?: string | { labels?: string[]; assignees?: string[] },
        options?: { labels?: string[]; assignees?: string[] }
    ): Promise<{ id: string; number: number; url?: string } | null> {
        if (typeof bodyOrOptions === 'string') {
            // Called with (owner, repo, title, body, options?)
            const result = await super.createIssue(
                toRepoInfo(ownerOrRepo as string, repoOrTitle),
                titleOrBody,
                bodyOrOptions
            );
            if (!result) return null;

            // Handle labels and assignees if provided
            const repoInfo = toRepoInfo(ownerOrRepo as string, repoOrTitle);
            if (options?.labels?.length) {
                for (const label of options.labels) {
                    await super.addLabelToIssue(repoInfo, result.number, label);
                }
            }
            if (options?.assignees?.length) {
                await super.updateAssignees(repoInfo, result.number, options.assignees);
            }

            return result;
        }
        // Called with (RepoInfo, title, body)
        return super.createIssue(
            ownerOrRepo as RepoInfo,
            repoOrTitle,
            titleOrBody
        );
    }

    // =========================================================================
    // Old VSCode API Compatibility Layer
    // These methods match the OLD VSCode GitHubAPI signatures (owner, repo, ...)
    // =========================================================================

    /**
     * Remove label from issue - OLD signature (owner, repo, issueNumber, labelName)
     * Overloads the core method which uses (RepoInfo, issueNumber, labelName)
     */
    async removeLabelFromIssue(
        ownerOrRepo: string | RepoInfo,
        repoOrIssueNumber: string | number,
        issueNumberOrLabelName: number | string,
        labelName?: string
    ): Promise<boolean> {
        if (typeof ownerOrRepo === 'string' && typeof repoOrIssueNumber === 'string') {
            // Called with (owner, repo, issueNumber, labelName)
            return super.removeLabelFromIssue(
                toRepoInfo(ownerOrRepo, repoOrIssueNumber),
                issueNumberOrLabelName as number,
                labelName!
            );
        }
        // Called with (RepoInfo, issueNumber, labelName)
        return super.removeLabelFromIssue(
            ownerOrRepo as RepoInfo,
            repoOrIssueNumber as number,
            issueNumberOrLabelName as string
        );
    }

    /**
     * Add sub-issue - OLD signature (owner, repo, parentNumber, childNumber)
     */
    async addSubIssue(
        ownerOrRepo: string | RepoInfo,
        repoOrParentNumber: string | number,
        parentNumberOrChildNumber: number,
        childNumber?: number
    ): Promise<boolean> {
        if (typeof ownerOrRepo === 'string' && typeof repoOrParentNumber === 'string') {
            // Called with (owner, repo, parentNumber, childNumber)
            return super.addSubIssue(
                toRepoInfo(ownerOrRepo, repoOrParentNumber),
                parentNumberOrChildNumber,
                childNumber!
            );
        }
        // Called with (RepoInfo, parentNumber, childNumber)
        return super.addSubIssue(
            ownerOrRepo as RepoInfo,
            repoOrParentNumber as number,
            parentNumberOrChildNumber
        );
    }

    /**
     * Add issue to project - overload supporting both signatures
     * OLD VSCode: (projectId: string, issueId: string) -> Promise<string | null>
     * Core: (repo: RepoInfo, issueNumber: number, projectId: string) -> Promise<boolean>
     */
    // @ts-expect-error - intentionally overloading with different return type for compatibility
    async addIssueToProject(
        projectIdOrRepo: string | RepoInfo,
        issueIdOrNumber: string | number,
        projectId?: string
    ): Promise<string | boolean | null> {
        if (typeof projectIdOrRepo === 'string' && typeof issueIdOrNumber === 'string') {
            // Called with (projectId, issueId) - OLD VSCode signature
            return this.addToProject(projectIdOrRepo, issueIdOrNumber);
        }
        // Called with (repo, issueNumber, projectId) - Core signature
        return super.addIssueToProject(
            projectIdOrRepo as RepoInfo,
            issueIdOrNumber as number,
            projectId!
        );
    }

    /**
     * Remove sub-issue - OLD signature (owner, repo, parentNumber, childNumber)
     */
    async removeSubIssue(
        ownerOrRepo: string | RepoInfo,
        repoOrParentNumber: string | number,
        parentNumberOrChildNumber: number,
        childNumber?: number
    ): Promise<boolean> {
        if (typeof ownerOrRepo === 'string' && typeof repoOrParentNumber === 'string') {
            // Called with (owner, repo, parentNumber, childNumber)
            return super.removeSubIssue(
                toRepoInfo(ownerOrRepo, repoOrParentNumber),
                parentNumberOrChildNumber,
                childNumber!
            );
        }
        // Called with (RepoInfo, parentNumber, childNumber)
        return super.removeSubIssue(
            ownerOrRepo as RepoInfo,
            repoOrParentNumber as number,
            parentNumberOrChildNumber
        );
    }

    /**
     * Get issue relationships - OLD signature (owner, repo, issueNumber)
     */
    async getIssueRelationships(
        ownerOrRepo: string | RepoInfo,
        repoOrIssueNumber: string | number,
        issueNumber?: number
    ): Promise<IssueRelationships | null> {
        if (typeof ownerOrRepo === 'string' && typeof repoOrIssueNumber === 'string') {
            // Called with (owner, repo, issueNumber)
            return super.getIssueRelationships(
                toRepoInfo(ownerOrRepo, repoOrIssueNumber),
                issueNumber!
            );
        }
        // Called with (RepoInfo, issueNumber)
        return super.getIssueRelationships(
            ownerOrRepo as RepoInfo,
            repoOrIssueNumber as number
        );
    }

    // =========================================================================
    // Additional Signature Adapters
    // =========================================================================

    /**
     * Update an issue's body (adapter)
     */
    async updateIssueBodyByOwnerRepo(
        owner: string,
        repo: string,
        issueNumber: number,
        body: string
    ): Promise<boolean> {
        return this.updateIssueBody(toRepoInfo(owner, repo), issueNumber, body);
    }

    /**
     * Get collaborators (adapter)
     */
    async getCollaboratorsByOwnerRepo(
        owner: string,
        repo: string
    ): Promise<Collaborator[]> {
        return this.getCollaborators(toRepoInfo(owner, repo));
    }

    /**
     * Update assignees (adapter with itemType parameter)
     */
    async updateAssigneesByOwnerRepo(
        owner: string,
        repo: string,
        issueNumber: number,
        assigneeLogins: string[],
        _itemType: 'issue' | 'pr' = 'issue'
    ): Promise<boolean> {
        return this.updateAssignees(toRepoInfo(owner, repo), issueNumber, assigneeLogins);
    }

    /**
     * Create issue (adapter with additional options)
     */
    async createIssueByOwnerRepo(
        owner: string,
        repo: string,
        title: string,
        body: string,
        options?: {
            labels?: string[];
            assignees?: string[];
        }
    ): Promise<{ id: string; number: number; url?: string } | null> {
        const result = await this.createIssue(toRepoInfo(owner, repo), title, body);
        if (!result) return null;

        // Handle labels and assignees if provided
        const repoInfo = toRepoInfo(owner, repo);
        if (options?.labels?.length) {
            for (const label of options.labels) {
                await this.addLabelToIssue(repoInfo, result.number, label);
            }
        }
        if (options?.assignees?.length) {
            await this.updateAssignees(repoInfo, result.number, options.assignees);
        }

        return result;
    }

    /**
     * Ensure label exists (adapter)
     */
    async ensureLabelByOwnerRepo(
        owner: string,
        repo: string,
        labelName: string,
        color: string = '1f883d',
        _description?: string
    ): Promise<boolean> {
        return this.ensureLabel(toRepoInfo(owner, repo), labelName, color);
    }

    /**
     * Add label to issue (adapter)
     */
    async addLabelToIssueByOwnerRepo(
        owner: string,
        repo: string,
        issueNumber: number,
        labelName: string
    ): Promise<boolean> {
        return this.addLabelToIssue(toRepoInfo(owner, repo), issueNumber, labelName);
    }

    /**
     * Remove label from issue (adapter)
     */
    async removeLabelFromIssueByOwnerRepo(
        owner: string,
        repo: string,
        issueNumber: number,
        labelName: string
    ): Promise<boolean> {
        return this.removeLabelFromIssue(toRepoInfo(owner, repo), issueNumber, labelName);
    }

    /**
     * Find issues with label (adapter - returns issue numbers)
     */
    async findIssuesWithLabelByOwnerRepo(
        owner: string,
        repo: string,
        labelName: string
    ): Promise<Array<{ number: number; title: string }>> {
        const numbers = await this.findIssuesWithLabel(toRepoInfo(owner, repo), labelName);
        // Core returns just numbers, convert to the format VSCode expects
        return numbers.map(num => ({ number: num, title: '' }));
    }

    /**
     * Get issue node ID (adapter)
     */
    async getIssueNodeIdByOwnerRepo(
        owner: string,
        repo: string,
        issueNumber: number
    ): Promise<string | null> {
        return this.getIssueNodeId(toRepoInfo(owner, repo), issueNumber);
    }

    /**
     * Add sub-issue (adapter)
     */
    async addSubIssueByOwnerRepo(
        owner: string,
        repo: string,
        parentNumber: number,
        childNumber: number
    ): Promise<boolean> {
        return this.addSubIssue(toRepoInfo(owner, repo), parentNumber, childNumber);
    }

    /**
     * Remove sub-issue (adapter)
     */
    async removeSubIssueByOwnerRepo(
        owner: string,
        repo: string,
        parentNumber: number,
        childNumber: number
    ): Promise<boolean> {
        return this.removeSubIssue(toRepoInfo(owner, repo), parentNumber, childNumber);
    }

    /**
     * Get issue relationships (adapter)
     */
    async getIssueRelationshipsByOwnerRepo(
        owner: string,
        repo: string,
        issueNumber: number
    ): Promise<IssueRelationships | null> {
        return this.getIssueRelationships(toRepoInfo(owner, repo), issueNumber);
    }

    /**
     * Add issue to project (adapter - different parameter order)
     */
    async addIssueToProjectByIds(
        projectId: string,
        issueId: string
    ): Promise<string | null> {
        return this.addToProject(projectId, issueId);
    }
}

// Export singleton for easy access
let apiInstance: VSCodeGitHubAPI | null = null;

export function getVSCodeGitHubAPI(): VSCodeGitHubAPI {
    if (!apiInstance) {
        apiInstance = new VSCodeGitHubAPI();
    }
    return apiInstance;
}

// Backwards compatibility alias - allows other files to import GitHubAPI
// and get VSCodeGitHubAPI without changing their code
export { VSCodeGitHubAPI as GitHubAPI };

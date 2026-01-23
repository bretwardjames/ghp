import * as vscode from 'vscode';
import { graphql } from '@octokit/graphql';
import type {
    ProjectV2,
    ProjectV2Item,
    NormalizedProjectItem,
    ProjectConfig,
    SingleSelectFieldValue,
    ProjectWithFields,
    ProjectWithViews,
    ProjectV2View,
    ProjectField,
    IssueRelationships,
} from './types';
import type { RepoInfo } from './repo-detector';

// Re-export for consumers that import from github-api
export type { IssueRelationships } from './types';

/**
 * GitHub API client for Projects V2
 * Uses VS Code's built-in GitHub authentication provider
 */
export class GitHubAPI {
    private graphqlClient: typeof graphql | null = null;
    private graphqlWithSubIssues: typeof graphql | null = null;
    private currentUser: string | null = null;

    /**
     * Authenticate with GitHub using VS Code's built-in auth provider
     */
    async authenticate(): Promise<boolean> {
        try {
            // Need 'project' scope for read/write access to GitHub Projects
            const session = await vscode.authentication.getSession('github', ['project', 'repo'], {
                createIfNone: true,
            });

            if (!session) {
                return false;
            }

            this.graphqlClient = graphql.defaults({
                headers: {
                    authorization: `token ${session.accessToken}`,
                },
            });

            // Separate client for sub-issues API (experimental feature)
            this.graphqlWithSubIssues = graphql.defaults({
                headers: {
                    authorization: `token ${session.accessToken}`,
                    'GraphQL-Features': 'sub_issues',
                },
            });

            // Fetch current user
            const { viewer } = await this.graphqlClient<{ viewer: { login: string } }>(`
                query {
                    viewer {
                        login
                    }
                }
            `);
            this.currentUser = viewer.login;

            return true;
        } catch (error) {
            console.error('GitHub authentication failed:', error);
            return false;
        }
    }

    get isAuthenticated(): boolean {
        return this.graphqlClient !== null;
    }

    get username(): string | null {
        return this.currentUser;
    }

    /**
     * Fetch all projects accessible to the current user
     */
    async getMyProjects(): Promise<ProjectV2[]> {
        if (!this.graphqlClient) {
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

        const response = await this.graphqlClient<{
            viewer: { projectsV2: { nodes: ProjectV2[] } };
        }>(query);

        return response.viewer.projectsV2.nodes.filter((p) => !p.closed);
    }

    /**
     * Fetch a project by owner and number
     */
    async getProject(config: ProjectConfig): Promise<ProjectV2 | null> {
        if (!this.graphqlClient) {
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
            const response = await this.graphqlClient<{
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
     * Fetch items from a project, optionally filtered to the current user
     */
    async getProjectItems(
        projectId: string,
        options: {
            assignedToMe?: boolean;
            statusFieldName?: string;
        } = {}
    ): Promise<NormalizedProjectItem[]> {
        if (!this.graphqlClient) {
            throw new Error('Not authenticated');
        }

        const query = `
            query($projectId: ID!, $cursor: String) {
                node(id: $projectId) {
                    ... on ProjectV2 {
                        items(first: 50, after: $cursor) {
                            pageInfo {
                                hasNextPage
                                endCursor
                            }
                            nodes {
                                id
                                type
                                content {
                                    ... on Issue {
                                        __typename
                                        title
                                        number
                                        url
                                        state
                                        issueType {
                                            name
                                        }
                                        repository {
                                            name
                                            owner {
                                                login
                                            }
                                        }
                                        assignees(first: 10) {
                                            nodes {
                                                login
                                                avatarUrl(size: 32)
                                            }
                                        }
                                        labels(first: 10) {
                                            nodes {
                                                name
                                                color
                                            }
                                        }
                                    }
                                    ... on PullRequest {
                                        __typename
                                        title
                                        number
                                        url
                                        state
                                        repository {
                                            name
                                            owner {
                                                login
                                            }
                                        }
                                        assignees(first: 10) {
                                            nodes {
                                                login
                                                avatarUrl(size: 32)
                                            }
                                        }
                                        labels(first: 10) {
                                            nodes {
                                                name
                                                color
                                            }
                                        }
                                    }
                                    ... on DraftIssue {
                                        __typename
                                        title
                                    }
                                }
                                fieldValues(first: 20) {
                                    nodes {
                                        ... on ProjectV2ItemFieldSingleSelectValue {
                                            __typename
                                            name
                                            color
                                            field { ... on ProjectV2SingleSelectField { name } }
                                        }
                                        ... on ProjectV2ItemFieldTextValue {
                                            __typename
                                            text
                                            field { ... on ProjectV2Field { name } }
                                        }
                                        ... on ProjectV2ItemFieldIterationValue {
                                            __typename
                                            title
                                            field { ... on ProjectV2IterationField { name } }
                                        }
                                        ... on ProjectV2ItemFieldNumberValue {
                                            __typename
                                            number
                                            field { ... on ProjectV2Field { name } }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `;

        const allItems: ProjectV2Item[] = [];
        let cursor: string | null = null;
        let hasNextPage = true;

        while (hasNextPage) {
            type ProjectItemsResponse = {
                node: {
                    items: {
                        pageInfo: { hasNextPage: boolean; endCursor: string | null };
                        nodes: ProjectV2Item[];
                    };
                };
            };
            const response: ProjectItemsResponse = await this.graphqlClient<ProjectItemsResponse>(
                query,
                { projectId, cursor }
            );

            allItems.push(...response.node.items.nodes);
            hasNextPage = response.node.items.pageInfo.hasNextPage;
            cursor = response.node.items.pageInfo.endCursor;

            // Safety limit
            if (allItems.length > 500) {
                break;
            }
        }

        // Normalize and filter items
        let normalized = allItems.map((item) =>
            this.normalizeItem(item, options.statusFieldName || 'Status')
        );

        if (options.assignedToMe && this.currentUser) {
            normalized = normalized.filter(
                (item) =>
                    item.assignees.some((a) => a.login === this.currentUser!) ||
                    item.type === 'draft' // Include drafts as they might be mine
            );
        }

        return normalized;
    }

    /**
     * Fetch projects linked to a specific repository
     * This includes both repo-level projects and org-level projects that contain repo items
     */
    async getProjectsForRepo(repo: RepoInfo): Promise<ProjectWithFields[]> {
        if (!this.graphqlClient) {
            throw new Error('Not authenticated');
        }

        const projects: ProjectWithFields[] = [];

        // Query repository-linked projects
        const repoQuery = `
            query($owner: String!, $name: String!) {
                repository(owner: $owner, name: $name) {
                    projectsV2(first: 20) {
                        nodes {
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
                        }
                    }
                }
            }
        `;

        try {
            const repoResponse = await this.graphqlClient<{
                repository: {
                    projectsV2: {
                        nodes: ProjectV2[];
                    };
                };
            }>(repoQuery, { owner: repo.owner, name: repo.name });

            for (const project of repoResponse.repository.projectsV2.nodes) {
                if (!project.closed) {
                    projects.push(this.enrichProjectWithStatusInfo(project));
                }
            }
        } catch (error) {
            console.error('Failed to fetch repo projects:', error);
        }

        // Also try to get organization-level projects if the owner is an org
        try {
            const orgQuery = `
                query($owner: String!) {
                    organization(login: $owner) {
                        projectsV2(first: 20) {
                            nodes {
                                id
                                title
                                number
                                url
                                closed
                                shortDescription
                                owner {
                                    ... on Organization {
                                        login
                                        __typename
                                    }
                                }
                                fields(first: 30) {
                                    nodes {
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
                            }
                        }
                    }
                }
            `;

            const orgResponse = await this.graphqlClient<{
                organization: {
                    projectsV2: {
                        nodes: ProjectV2[];
                    };
                };
            }>(orgQuery, { owner: repo.owner });

            for (const project of orgResponse.organization.projectsV2.nodes) {
                // Avoid duplicates
                if (!project.closed && !projects.some((p) => p.id === project.id)) {
                    projects.push(this.enrichProjectWithStatusInfo(project));
                }
            }
        } catch {
            // Owner is not an org, or no access - that's fine
        }

        return projects;
    }

    /**
     * Fetch projects linked to a repository WITH their views configuration
     * This is the primary method for getting projects to display in the sidebar
     */
    async getProjectsWithViews(repo: RepoInfo): Promise<ProjectWithViews[]> {
        if (!this.graphqlClient) {
            throw new Error('Not authenticated');
        }

        const projects: ProjectWithViews[] = [];

        // GraphQL fragment for project with views
        // Note: ProjectV2FieldConfiguration is a union type, so fragments are peers, not nested
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
            const repoResponse = await this.graphqlClient<{
                repository: {
                    projectsV2: {
                        nodes: Array<ProjectV2 & {
                            views: { nodes: ProjectV2View[] };
                            fields: { nodes: ProjectField[] };
                        }>;
                    };
                };
            }>(repoQuery, { owner: repo.owner, name: repo.name });

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
            console.error('Failed to fetch repo projects with views:', error);
            // Check for SSO-related errors
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('SSO') || errorMessage.includes('SAML')) {
                throw new Error(
                    `SSO Authorization Required: Your OAuth token needs to be authorized for the ${repo.owner} organization. ` +
                    `Visit github.com/settings/connections/applications to authorize.`
                );
            }
            // Surface the actual error for debugging
            throw new Error(`Failed to access projects for ${repo.owner}/${repo.name}: ${errorMessage}`);
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

            const orgResponse = await this.graphqlClient<{
                organization: {
                    projectsV2: {
                        nodes: Array<ProjectV2 & {
                            views: { nodes: ProjectV2View[] };
                            fields: { nodes: ProjectField[] };
                        }>;
                    };
                };
            }>(orgQuery, { owner: repo.owner });

            for (const project of orgResponse.organization.projectsV2.nodes) {
                if (!project.closed && !projects.some((p) => p.id === project.id)) {
                    projects.push({
                        ...project,
                        views: project.views.nodes,
                        fields: project.fields,
                    });
                }
            }
        } catch (error) {
            // Check for SSO-related errors on org query
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('SSO') || errorMessage.includes('SAML')) {
                console.error('SSO authorization needed for organization:', repo.owner);
                throw new Error(
                    `SSO Authorization Required: Your OAuth token needs to be authorized for the ${repo.owner} organization. ` +
                    `Visit github.com/settings/connections/applications to authorize.`
                );
            }
            // Log but don't throw - owner might just not be an org
            console.log(`Org query for ${repo.owner} failed (may not be an org):`, errorMessage);
        }

        // Initialize empty fields - we'll derive column info from item values instead
        // (GitHub's GraphQL API has union type issues with the fields query)
        for (const project of projects) {
            if (!project.fields) {
                project.fields = { nodes: [] };
            }
        }

        return projects;
    }

    /**
     * Get the column order for a board view based on the groupBy field options
     * Note: groupByFields may not be available due to GraphQL API limitations
     */
    getViewColumns(view: ProjectV2View): Array<{ id: string; name: string; color?: string }> {
        const groupByField = view.groupByFields?.nodes?.[0];
        if (!groupByField || !('options' in groupByField) || !groupByField.options) {
            return [];
        }
        return groupByField.options;
    }

    /**
     * Extract status field info from a project
     */
    private enrichProjectWithStatusInfo(project: ProjectV2): ProjectWithFields {
        let statusField: ProjectField | null = null;
        const statusOptions: string[] = [];

        if (project.fields?.nodes) {
            // Look for a field that looks like a status field
            for (const field of project.fields.nodes) {
                if (field.__typename === 'ProjectV2SingleSelectField') {
                    const fieldName = field.name.toLowerCase();
                    if (
                        fieldName === 'status' ||
                        fieldName === 'state' ||
                        fieldName === 'stage'
                    ) {
                        statusField = field;
                        if (field.options) {
                            statusOptions.push(...field.options.map((o) => o.name));
                        }
                        break;
                    }
                }
            }

            // If no obvious status field, take the first single-select field
            if (!statusField) {
                const firstSelect = project.fields.nodes.find(
                    (f) => f.__typename === 'ProjectV2SingleSelectField'
                );
                if (firstSelect) {
                    statusField = firstSelect;
                    if (firstSelect.options) {
                        statusOptions.push(...firstSelect.options.map((o) => o.name));
                    }
                }
            }
        }

        return {
            ...project,
            statusField,
            statusOptions,
        };
    }

    /**
     * Get the GraphQL client for external use (e.g., owner type detection)
     */
    getGraphQLClient() {
        return this.graphqlClient;
    }

    /**
     * Convert raw API response to normalized format
     */
    private normalizeItem(item: ProjectV2Item, _statusFieldName: string): NormalizedProjectItem {
        const fields = new Map<string, { value: string; color: string | null }>();
        let status: string | null = null;

        // Extract field values with their actual field names and colors
        for (const fieldValue of item.fieldValues.nodes) {
            if (!fieldValue) continue;

            const fv = fieldValue as unknown as Record<string, unknown>;
            const fieldDef = fv.field as { name?: string } | undefined;
            const fieldName = fieldDef?.name || null;

            if (fieldValue.__typename === 'ProjectV2ItemFieldSingleSelectValue') {
                const valueName = fv.name as string;
                const color = fv.color as string | null;
                if (valueName && fieldName) {
                    const fieldNameLower = fieldName.toLowerCase();
                    // Check if this is the Status field (also check for common variations)
                    if (fieldNameLower === 'status' || fieldNameLower === 'state' || fieldNameLower === 'stage') {
                        status = valueName;
                    }
                    fields.set(fieldNameLower, { value: valueName, color });
                }
            } else if (fieldValue.__typename === 'ProjectV2ItemFieldTextValue') {
                const textValue = fv.text as string;
                if (textValue && fieldName) {
                    fields.set(fieldName.toLowerCase(), { value: textValue, color: null });
                }
            } else if (fieldValue.__typename === 'ProjectV2ItemFieldIterationValue') {
                const iterationTitle = fv.title as string;
                if (iterationTitle && fieldName) {
                    fields.set(fieldName.toLowerCase(), { value: iterationTitle, color: null });
                }
            } else if (fieldValue.__typename === 'ProjectV2ItemFieldNumberValue') {
                const numberValue = fv.number as number;
                if (numberValue !== null && numberValue !== undefined && fieldName) {
                    fields.set(fieldName.toLowerCase(), { value: String(numberValue), color: null });
                }
            }
        }

        const content = item.content;
        const assignees =
            content?.assignees?.nodes.map((a: { login: string; avatarUrl?: string }) => ({
                login: a.login,
                avatarUrl: a.avatarUrl || null,
            })) || [];

        // Extract labels from issue/PR content (with colors)
        const contentAny = content as Record<string, unknown> | null;
        const labelsNode = contentAny?.labels as { nodes: Array<{ name: string; color: string }> } | undefined;
        const labels = labelsNode?.nodes.map((l) => ({ name: l.name, color: l.color ? `#${l.color}` : null })) || [];

        let state: 'open' | 'closed' | 'merged' | null = null;
        if (content?.state) {
            state = content.state.toLowerCase() as 'open' | 'closed' | 'merged';
        }

        // Extract issue type (only available on issues)
        const issueType = (contentAny?.issueType as { name: string } | null)?.name || null;

        return {
            id: item.id,
            title: content?.title || 'Untitled',
            type: item.type === 'ISSUE' ? 'issue' : item.type === 'PULL_REQUEST' ? 'pr' : 'draft',
            status,
            url: content?.url || null,
            number: content?.number || null,
            repository: content?.repository?.owner
                ? `${content.repository.owner.login}/${content.repository.name}`
                : null,
            assignees,
            labels,
            state,
            fields,
            issueType,
        };
    }

    /**
     * Update a project item's status field
     * @param projectId The project's node ID
     * @param itemId The item's node ID
     * @param statusFieldId The status field's node ID
     * @param statusOptionId The option's node ID to set
     */
    async updateItemStatus(
        projectId: string,
        itemId: string,
        statusFieldId: string,
        statusOptionId: string
    ): Promise<boolean> {
        if (!this.graphqlClient) {
            throw new Error('Not authenticated');
        }

        const mutation = `
            mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
                updateProjectV2ItemFieldValue(
                    input: {
                        projectId: $projectId
                        itemId: $itemId
                        fieldId: $fieldId
                        value: { singleSelectOptionId: $optionId }
                    }
                ) {
                    projectV2Item {
                        id
                    }
                }
            }
        `;

        try {
            await this.graphqlClient(mutation, {
                projectId,
                itemId,
                fieldId: statusFieldId,
                optionId: statusOptionId,
            });
            return true;
        } catch (error) {
            console.error('Failed to update item status:', error);
            return false;
        }
    }

    /**
     * Find the status field and option IDs for a project
     */
    findStatusFieldAndOption(
        project: ProjectWithViews,
        targetStatusName: string
    ): { fieldId: string; optionId: string } | null {
        // Look for status field in project fields
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

        // Find the target option
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

    /**
     * Update a project item's status by name (queries for field/option IDs automatically)
     * @param projectId The project's node ID
     * @param itemId The item's node ID
     * @param statusName The status name to set (e.g., "In Progress", "Done")
     */
    async updateItemStatusByName(
        projectId: string,
        itemId: string,
        statusName: string
    ): Promise<boolean> {
        if (!this.graphqlClient) {
            throw new Error('Not authenticated');
        }

        // First, query the project to get status field and options
        const query = `
            query($projectId: ID!) {
                node(id: $projectId) {
                    ... on ProjectV2 {
                        fields(first: 30) {
                            nodes {
                                ... on ProjectV2SingleSelectField {
                                    __typename
                                    id
                                    name
                                    options {
                                        id
                                        name
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `;

        try {
            const response = await this.graphqlClient<{
                node: {
                    fields: {
                        nodes: Array<{
                            __typename?: string;
                            id?: string;
                            name?: string;
                            options?: Array<{ id: string; name: string }>;
                        }>;
                    };
                };
            }>(query, { projectId });

            // Find the status field
            const statusField = response.node.fields.nodes.find(
                (f) =>
                    f.__typename === 'ProjectV2SingleSelectField' &&
                    (f.name?.toLowerCase() === 'status' ||
                        f.name?.toLowerCase() === 'state' ||
                        f.name?.toLowerCase() === 'stage')
            );

            if (!statusField || !statusField.options || !statusField.id) {
                console.error('Status field not found in project');
                return false;
            }

            // Find the target option
            const targetOption = statusField.options.find(
                (o) => o.name.toLowerCase() === statusName.toLowerCase()
            );

            if (!targetOption) {
                console.error(`Status option "${statusName}" not found. Available: ${statusField.options.map(o => o.name).join(', ')}`);
                return false;
            }

            // Now update the item
            return await this.updateItemStatus(projectId, itemId, statusField.id, targetOption.id);
        } catch (error) {
            console.error('Failed to update item status by name:', error);
            throw error;
        }
    }

    /**
     * Get all single-select fields for a project with their options
     */
    async getProjectFields(projectId: string): Promise<Array<{
        id: string;
        name: string;
        options: Array<{ id: string; name: string }>;
    }>> {
        if (!this.graphqlClient) {
            throw new Error('Not authenticated');
        }

        const query = `
            query($projectId: ID!) {
                node(id: $projectId) {
                    ... on ProjectV2 {
                        fields(first: 30) {
                            nodes {
                                ... on ProjectV2SingleSelectField {
                                    __typename
                                    id
                                    name
                                    options {
                                        id
                                        name
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `;

        try {
            const response = await this.graphqlClient<{
                node: {
                    fields: {
                        nodes: Array<{
                            __typename?: string;
                            id?: string;
                            name?: string;
                            options?: Array<{ id: string; name: string }>;
                        }>;
                    };
                };
            }>(query, { projectId });

            return response.node.fields.nodes
                .filter((f) => f.__typename === 'ProjectV2SingleSelectField' && f.id && f.name)
                .map((f) => ({
                    id: f.id!,
                    name: f.name!,
                    options: f.options || [],
                }));
        } catch (error) {
            console.error('Failed to get project fields:', error);
            return [];
        }
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
        if (!this.graphqlClient) {
            throw new Error('Not authenticated');
        }

        const mutation = `
            mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
                updateProjectV2ItemFieldValue(
                    input: {
                        projectId: $projectId
                        itemId: $itemId
                        fieldId: $fieldId
                        value: { singleSelectOptionId: $optionId }
                    }
                ) {
                    projectV2Item {
                        id
                    }
                }
            }
        `;

        try {
            console.log('Updating field:', { projectId, itemId, fieldId, optionId });
            const result = await this.graphqlClient(mutation, {
                projectId,
                itemId,
                fieldId,
                optionId,
            });
            console.log('Update result:', result);
            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Failed to update item field:', errorMessage);
            throw new Error(`Failed to update field: ${errorMessage}`);
        }
    }

    /**
     * Update assignees on an issue or PR
     */
    async updateAssignees(
        owner: string,
        repo: string,
        issueNumber: number,
        assigneeLogins: string[],
        itemType: 'issue' | 'pr'
    ): Promise<boolean> {
        if (!this.graphqlClient) {
            throw new Error('Not authenticated');
        }

        try {
            // Get the issue/PR node ID and current assignees
            const query = itemType === 'issue' ? `
                query($owner: String!, $repo: String!, $number: Int!) {
                    repository(owner: $owner, name: $repo) {
                        issue(number: $number) {
                            id
                            assignees(first: 20) {
                                nodes {
                                    id
                                    login
                                }
                            }
                        }
                    }
                }
            ` : `
                query($owner: String!, $repo: String!, $number: Int!) {
                    repository(owner: $owner, name: $repo) {
                        pullRequest(number: $number) {
                            id
                            assignees(first: 20) {
                                nodes {
                                    id
                                    login
                                }
                            }
                        }
                    }
                }
            `;

            const response = await this.graphqlClient<{
                repository: {
                    issue?: { id: string; assignees: { nodes: Array<{ id: string; login: string }> } };
                    pullRequest?: { id: string; assignees: { nodes: Array<{ id: string; login: string }> } };
                };
            }>(query, { owner, repo, number: issueNumber });

            const item = response.repository.issue || response.repository.pullRequest;
            if (!item) {
                throw new Error('Issue/PR not found');
            }

            const currentAssignees = item.assignees.nodes;
            const currentLogins = currentAssignees.map((a) => a.login.toLowerCase());

            // Get user IDs for new assignees
            const newAssigneeIds: string[] = [];
            for (const login of assigneeLogins) {
                // Check if already in current assignees
                const existing = currentAssignees.find((a) => a.login.toLowerCase() === login.toLowerCase());
                if (existing) {
                    newAssigneeIds.push(existing.id);
                } else {
                    // Need to look up the user ID
                    const userQuery = `
                        query($login: String!) {
                            user(login: $login) {
                                id
                            }
                        }
                    `;
                    const userResponse = await this.graphqlClient<{
                        user: { id: string } | null;
                    }>(userQuery, { login });

                    if (userResponse.user) {
                        newAssigneeIds.push(userResponse.user.id);
                    }
                }
            }

            // Determine who to add and remove
            const toAdd = newAssigneeIds.filter((id) =>
                !currentAssignees.some((a) => a.id === id)
            );
            const toRemove = currentAssignees
                .filter((a) => !assigneeLogins.some((l) => l.toLowerCase() === a.login.toLowerCase()))
                .map((a) => a.id);

            // Add new assignees
            if (toAdd.length > 0) {
                await this.graphqlClient(`
                    mutation($assignableId: ID!, $assigneeIds: [ID!]!) {
                        addAssigneesToAssignable(input: {
                            assignableId: $assignableId
                            assigneeIds: $assigneeIds
                        }) {
                            assignable {
                                ... on Issue { id }
                                ... on PullRequest { id }
                            }
                        }
                    }
                `, { assignableId: item.id, assigneeIds: toAdd });
            }

            // Remove old assignees
            if (toRemove.length > 0) {
                await this.graphqlClient(`
                    mutation($assignableId: ID!, $assigneeIds: [ID!]!) {
                        removeAssigneesFromAssignable(input: {
                            assignableId: $assignableId
                            assigneeIds: $assigneeIds
                        }) {
                            assignable {
                                ... on Issue { id }
                                ... on PullRequest { id }
                            }
                        }
                    }
                `, { assignableId: item.id, assigneeIds: toRemove });
            }

            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Failed to update assignees:', errorMessage);
            throw new Error(`Failed to update assignees: ${errorMessage}`);
        }
    }

    /**
     * Get repository collaborators for assignee suggestions
     */
    async getCollaborators(owner: string, repo: string): Promise<Array<{ login: string; avatarUrl: string }>> {
        if (!this.graphqlClient) {
            throw new Error('Not authenticated');
        }

        const query = `
            query($owner: String!, $repo: String!) {
                repository(owner: $owner, name: $repo) {
                    collaborators(first: 50) {
                        nodes {
                            login
                            avatarUrl
                        }
                    }
                }
            }
        `;

        try {
            const response = await this.graphqlClient<{
                repository: {
                    collaborators?: {
                        nodes: Array<{ login: string; avatarUrl: string }>;
                    };
                };
            }>(query, { owner, repo });

            return response.repository.collaborators?.nodes || [];
        } catch (error) {
            // Collaborators query may fail if user doesn't have admin access
            console.error('Failed to get collaborators:', error);
            return [];
        }
    }

    /**
     * Get available status options for a project
     */
    async getProjectStatusOptions(projectId: string): Promise<string[]> {
        if (!this.graphqlClient) {
            throw new Error('Not authenticated');
        }

        const query = `
            query($projectId: ID!) {
                node(id: $projectId) {
                    ... on ProjectV2 {
                        fields(first: 30) {
                            nodes {
                                ... on ProjectV2SingleSelectField {
                                    __typename
                                    name
                                    options {
                                        name
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `;

        try {
            const response = await this.graphqlClient<{
                node: {
                    fields: {
                        nodes: Array<{
                            __typename?: string;
                            name?: string;
                            options?: Array<{ name: string }>;
                        }>;
                    };
                };
            }>(query, { projectId });

            const statusField = response.node.fields.nodes.find(
                (f) =>
                    f.__typename === 'ProjectV2SingleSelectField' &&
                    (f.name?.toLowerCase() === 'status' ||
                        f.name?.toLowerCase() === 'state' ||
                        f.name?.toLowerCase() === 'stage')
            );

            return statusField?.options?.map((o) => o.name) || [];
        } catch (error) {
            console.error('Failed to get status options:', error);
            return [];
        }
    }

    /**
     * Find a PR associated with an issue
     * Checks for PRs that reference the issue number in the same repository
     */
    async findPRForIssue(
        item: NormalizedProjectItem
    ): Promise<{ state: 'open' | 'closed'; merged: boolean; url: string } | null> {
        if (!this.graphqlClient || !item.repository || !item.number) {
            return null;
        }

        const [owner, repo] = item.repository.split('/');
        if (!owner || !repo) {
            return null;
        }

        // Search for PRs that reference this issue
        // GitHub's search syntax: type:pr repo:owner/repo in:body #123
        const searchQuery = `type:pr repo:${owner}/${repo} in:body #${item.number}`;

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

            const response = await this.graphqlClient<{
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

            // Filter to PRs that actually reference this issue
            const prs = response.search.nodes.filter(
                (n) =>
                    n.__typename === 'PullRequest' &&
                    n.body?.includes(`#${item.number}`)
            );

            if (prs.length === 0) {
                return null;
            }

            // Return the most relevant PR (prefer merged, then open, then closed)
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
     * Get repository node ID (needed for creating issues)
     */
    async getRepositoryId(owner: string, repo: string): Promise<string | null> {
        if (!this.graphqlClient) {
            return null;
        }

        try {
            const response = await this.graphqlClient<{
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
     * Get available issue types for an organization
     * Note: Issue types require special GraphQL header - not yet supported
     */
    async getIssueTypes(_owner: string): Promise<Array<{ id: string; name: string }>> {
        // Issue types API requires 'GraphQL-Features: issue_types' header
        // which our graphql client doesn't easily support yet
        // For now, return empty - issue types are fetched from individual items
        return [];
    }

    /**
     * Create a new issue in a repository
     */
    async createIssue(
        owner: string,
        repo: string,
        title: string,
        body: string,
        options?: {
            labels?: string[];
            assignees?: string[];
            issueTypeId?: string;
        }
    ): Promise<{ id: string; number: number; url: string } | null> {
        if (!this.graphqlClient) {
            throw new Error('Not authenticated');
        }

        // Get repository ID
        const repositoryId = await this.getRepositoryId(owner, repo);
        if (!repositoryId) {
            throw new Error('Could not find repository');
        }

        // Build mutation input
        const input: Record<string, unknown> = {
            repositoryId,
            title,
            body,
        };

        // Note: GraphQL createIssue doesn't support labels/assignees directly
        // We need to use REST API or additional mutations for those

        try {
            const response = await this.graphqlClient<{
                createIssue: {
                    issue: {
                        id: string;
                        number: number;
                        url: string;
                    };
                };
            }>(`
                mutation($input: CreateIssueInput!) {
                    createIssue(input: $input) {
                        issue {
                            id
                            number
                            url
                        }
                    }
                }
            `, { input });

            const issue = response.createIssue.issue;

            // If labels or assignees were specified, update them via REST-style mutations
            if (options?.labels && options.labels.length > 0) {
                await this.addLabelsToIssue(owner, repo, issue.number, options.labels);
            }

            if (options?.assignees && options.assignees.length > 0) {
                await this.updateAssignees(owner, repo, issue.number, options.assignees, 'issue');
            }

            return issue;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Failed to create issue:', errorMessage);
            throw new Error(`Failed to create issue: ${errorMessage}`);
        }
    }

    /**
     * Add labels to an issue
     */
    private async addLabelsToIssue(
        owner: string,
        repo: string,
        issueNumber: number,
        labelNames: string[]
    ): Promise<void> {
        if (!this.graphqlClient) return;

        try {
            // Get issue ID and label IDs
            const response = await this.graphqlClient<{
                repository: {
                    issue: { id: string };
                    labels: { nodes: Array<{ id: string; name: string }> };
                };
            }>(`
                query($owner: String!, $repo: String!, $number: Int!, $labelNames: [String!]!) {
                    repository(owner: $owner, name: $repo) {
                        issue(number: $number) {
                            id
                        }
                        labels(first: 50, query: "") {
                            nodes {
                                id
                                name
                            }
                        }
                    }
                }
            `, { owner, repo, number: issueNumber, labelNames });

            const issueId = response.repository.issue.id;
            const labelIds = response.repository.labels.nodes
                .filter(l => labelNames.includes(l.name))
                .map(l => l.id);

            if (labelIds.length > 0) {
                await this.graphqlClient(`
                    mutation($issueId: ID!, $labelIds: [ID!]!) {
                        addLabelsToLabelable(input: { labelableId: $issueId, labelIds: $labelIds }) {
                            clientMutationId
                        }
                    }
                `, { issueId, labelIds });
            }
        } catch (error) {
            console.error('Failed to add labels:', error);
        }
    }

    /**
     * Add an issue to a project
     */
    async addIssueToProject(
        projectId: string,
        issueId: string
    ): Promise<string | null> {
        if (!this.graphqlClient) {
            throw new Error('Not authenticated');
        }

        try {
            const response = await this.graphqlClient<{
                addProjectV2ItemById: {
                    item: { id: string };
                };
            }>(`
                mutation($projectId: ID!, $contentId: ID!) {
                    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
                        item {
                            id
                        }
                    }
                }
            `, { projectId, contentId: issueId });

            return response.addProjectV2ItemById.item.id;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Failed to add issue to project:', errorMessage);
            throw new Error(`Failed to add issue to project: ${errorMessage}`);
        }
    }

    /**
     * Update an issue's body/description
     */
    async updateIssueBody(
        owner: string,
        repo: string,
        issueNumber: number,
        body: string
    ): Promise<boolean> {
        if (!this.graphqlClient) {
            throw new Error('Not authenticated');
        }

        try {
            // First get the issue node ID
            const issueResponse = await this.graphqlClient<{
                repository: {
                    issue: { id: string } | null;
                };
            }>(`
                query($owner: String!, $repo: String!, $number: Int!) {
                    repository(owner: $owner, name: $repo) {
                        issue(number: $number) {
                            id
                        }
                    }
                }
            `, { owner, repo, number: issueNumber });

            if (!issueResponse.repository.issue) {
                throw new Error('Issue not found');
            }

            // Update the issue body
            await this.graphqlClient(`
                mutation($issueId: ID!, $body: String!) {
                    updateIssue(input: { id: $issueId, body: $body }) {
                        issue {
                            id
                        }
                    }
                }
            `, {
                issueId: issueResponse.repository.issue.id,
                body,
            });

            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Failed to update issue body:', errorMessage);
            throw new Error(`Failed to update issue body: ${errorMessage}`);
        }
    }

    /**
     * Get an issue's body/description
     */
    async getIssueBody(
        owner: string,
        repo: string,
        issueNumber: number
    ): Promise<string | null> {
        if (!this.graphqlClient) {
            throw new Error('Not authenticated');
        }

        try {
            const response = await this.graphqlClient<{
                repository: {
                    issue: { body: string } | null;
                };
            }>(`
                query($owner: String!, $repo: String!, $number: Int!) {
                    repository(owner: $owner, name: $repo) {
                        issue(number: $number) {
                            body
                        }
                    }
                }
            `, { owner, repo, number: issueNumber });

            return response.repository.issue?.body ?? null;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Failed to get issue body:', errorMessage);
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Active Label Methods
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get the active label name for the current user (e.g., "@username:active")
     */
    getActiveLabelName(): string {
        if (!this.currentUser) {
            throw new Error('Not authenticated');
        }
        return `@${this.currentUser}:active`;
    }

    /**
     * Ensure a label exists in a repository, creating it if needed
     * @returns The label ID
     */
    async ensureLabel(
        owner: string,
        repo: string,
        labelName: string,
        color: string = '1d76db',
        description: string = ''
    ): Promise<string | null> {
        if (!this.graphqlClient) {
            throw new Error('Not authenticated');
        }

        // First check if label exists
        try {
            const checkResponse = await this.graphqlClient<{
                repository: {
                    label: { id: string; name: string } | null;
                };
            }>(`
                query($owner: String!, $repo: String!, $name: String!) {
                    repository(owner: $owner, name: $repo) {
                        label(name: $name) {
                            id
                            name
                        }
                    }
                }
            `, { owner, repo, name: labelName });

            if (checkResponse.repository.label) {
                return checkResponse.repository.label.id;
            }
        } catch {
            // Label doesn't exist, will create it
        }

        // Get repository ID for creating label
        const repositoryId = await this.getRepositoryId(owner, repo);
        if (!repositoryId) {
            return null;
        }

        // Create the label
        try {
            const createResponse = await this.graphqlClient<{
                createLabel: {
                    label: { id: string };
                };
            }>(`
                mutation($input: CreateLabelInput!) {
                    createLabel(input: $input) {
                        label {
                            id
                        }
                    }
                }
            `, {
                input: {
                    repositoryId,
                    name: labelName,
                    color,
                    description,
                },
            });

            return createResponse.createLabel.label.id;
        } catch (error) {
            console.error('Failed to create label:', error);
            return null;
        }
    }

    /**
     * Add a label to an issue (public method)
     */
    async addLabelToIssue(
        owner: string,
        repo: string,
        issueNumber: number,
        labelName: string
    ): Promise<boolean> {
        if (!this.graphqlClient) {
            throw new Error('Not authenticated');
        }

        try {
            // Get issue ID and label ID
            const response = await this.graphqlClient<{
                repository: {
                    issue: { id: string };
                    label: { id: string } | null;
                };
            }>(`
                query($owner: String!, $repo: String!, $number: Int!, $labelName: String!) {
                    repository(owner: $owner, name: $repo) {
                        issue(number: $number) {
                            id
                        }
                        label(name: $labelName) {
                            id
                        }
                    }
                }
            `, { owner, repo, number: issueNumber, labelName });

            if (!response.repository.label) {
                console.error(`Label "${labelName}" not found`);
                return false;
            }

            await this.graphqlClient(`
                mutation($issueId: ID!, $labelIds: [ID!]!) {
                    addLabelsToLabelable(input: { labelableId: $issueId, labelIds: $labelIds }) {
                        clientMutationId
                    }
                }
            `, {
                issueId: response.repository.issue.id,
                labelIds: [response.repository.label.id],
            });

            return true;
        } catch (error) {
            console.error('Failed to add label:', error);
            return false;
        }
    }

    /**
     * Remove a label from an issue
     */
    async removeLabelFromIssue(
        owner: string,
        repo: string,
        issueNumber: number,
        labelName: string
    ): Promise<boolean> {
        if (!this.graphqlClient) {
            throw new Error('Not authenticated');
        }

        try {
            // Get issue ID and label ID
            const response = await this.graphqlClient<{
                repository: {
                    issue: { id: string };
                    label: { id: string } | null;
                };
            }>(`
                query($owner: String!, $repo: String!, $number: Int!, $labelName: String!) {
                    repository(owner: $owner, name: $repo) {
                        issue(number: $number) {
                            id
                        }
                        label(name: $labelName) {
                            id
                        }
                    }
                }
            `, { owner, repo, number: issueNumber, labelName });

            if (!response.repository.label) {
                // Label doesn't exist, nothing to remove
                return true;
            }

            await this.graphqlClient(`
                mutation($issueId: ID!, $labelIds: [ID!]!) {
                    removeLabelsFromLabelable(input: { labelableId: $issueId, labelIds: $labelIds }) {
                        clientMutationId
                    }
                }
            `, {
                issueId: response.repository.issue.id,
                labelIds: [response.repository.label.id],
            });

            return true;
        } catch (error) {
            console.error('Failed to remove label:', error);
            return false;
        }
    }

    /**
     * Find issues in a repository that have a specific label
     */
    async findIssuesWithLabel(
        owner: string,
        repo: string,
        labelName: string
    ): Promise<Array<{ number: number; title: string }>> {
        if (!this.graphqlClient) {
            throw new Error('Not authenticated');
        }

        try {
            const response = await this.graphqlClient<{
                repository: {
                    issues: {
                        nodes: Array<{ number: number; title: string }>;
                    };
                };
            }>(`
                query($owner: String!, $repo: String!, $labels: [String!]!) {
                    repository(owner: $owner, name: $repo) {
                        issues(first: 50, states: [OPEN, CLOSED], labels: $labels) {
                            nodes {
                                number
                                title
                            }
                        }
                    }
                }
            `, { owner, repo, labels: [labelName] });

            return response.repository.issues.nodes;
        } catch (error) {
            console.error('Failed to find issues with label:', error);
            return [];
        }
    }

    /**
     * Transfer the active label from any other issues to the specified issue
     * This ensures only one issue has the active label at a time
     */
    async transferActiveLabel(
        owner: string,
        repo: string,
        targetIssueNumber: number
    ): Promise<boolean> {
        const labelName = this.getActiveLabelName();

        // Ensure the label exists
        await this.ensureLabel(
            owner,
            repo,
            labelName,
            '1d76db', // blue color
            `Currently active issue for @${this.currentUser}`
        );

        // Find other issues with this label
        const issuesWithLabel = await this.findIssuesWithLabel(owner, repo, labelName);

        // Remove label from other issues
        for (const issue of issuesWithLabel) {
            if (issue.number !== targetIssueNumber) {
                await this.removeLabelFromIssue(owner, repo, issue.number, labelName);
            }
        }

        // Add label to target issue
        return await this.addLabelToIssue(owner, repo, targetIssueNumber, labelName);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Sub-Issue / Parent-Child Relationships
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get the node ID for an issue
     */
    async getIssueNodeId(owner: string, repo: string, issueNumber: number): Promise<string | null> {
        if (!this.graphqlClient) {
            throw new Error('Not authenticated');
        }

        try {
            const response = await this.graphqlClient<{
                repository: {
                    issue: { id: string } | null;
                };
            }>(`
                query($owner: String!, $repo: String!, $number: Int!) {
                    repository(owner: $owner, name: $repo) {
                        issue(number: $number) {
                            id
                        }
                    }
                }
            `, { owner, repo, number: issueNumber });

            return response.repository.issue?.id ?? null;
        } catch {
            return null;
        }
    }

    /**
     * Add a sub-issue to a parent issue
     */
    async addSubIssue(
        owner: string,
        repo: string,
        parentNumber: number,
        childNumber: number
    ): Promise<boolean> {
        if (!this.graphqlWithSubIssues) {
            throw new Error('Not authenticated');
        }

        try {
            const [parentId, childId] = await Promise.all([
                this.getIssueNodeId(owner, repo, parentNumber),
                this.getIssueNodeId(owner, repo, childNumber),
            ]);

            if (!parentId || !childId) {
                return false;
            }

            await this.graphqlWithSubIssues(`
                mutation($issueId: ID!, $subIssueId: ID!) {
                    addSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId }) {
                        issue { id number title }
                        subIssue { id number title }
                    }
                }
            `, { issueId: parentId, subIssueId: childId });

            return true;
        } catch (error) {
            console.error('Failed to add sub-issue:', error);
            return false;
        }
    }

    /**
     * Remove a sub-issue from its parent issue
     */
    async removeSubIssue(
        owner: string,
        repo: string,
        parentNumber: number,
        childNumber: number
    ): Promise<boolean> {
        if (!this.graphqlWithSubIssues) {
            throw new Error('Not authenticated');
        }

        try {
            const [parentId, childId] = await Promise.all([
                this.getIssueNodeId(owner, repo, parentNumber),
                this.getIssueNodeId(owner, repo, childNumber),
            ]);

            if (!parentId || !childId) {
                return false;
            }

            await this.graphqlWithSubIssues(`
                mutation($issueId: ID!, $subIssueId: ID!) {
                    removeSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId }) {
                        issue { id number title }
                        subIssue { id number title }
                    }
                }
            `, { issueId: parentId, subIssueId: childId });

            return true;
        } catch (error) {
            console.error('Failed to remove sub-issue:', error);
            return false;
        }
    }

    /**
     * Get issue relationships (parent and sub-issues)
     */
    async getIssueRelationships(
        owner: string,
        repo: string,
        issueNumber: number
    ): Promise<IssueRelationships | null> {
        if (!this.graphqlWithSubIssues) {
            throw new Error('Not authenticated');
        }

        try {
            const response = await this.graphqlWithSubIssues<{
                repository: {
                    issue: {
                        id: string;
                        number: number;
                        title: string;
                        parent: { id: string; number: number; title: string; state: string } | null;
                        subIssues: {
                            nodes: Array<{ id: string; number: number; title: string; state: string }>;
                        };
                    } | null;
                };
            }>(`
                query($owner: String!, $repo: String!, $number: Int!) {
                    repository(owner: $owner, name: $repo) {
                        issue(number: $number) {
                            id
                            number
                            title
                            parent { id number title state }
                            subIssues(first: 50) {
                                nodes { id number title state }
                            }
                        }
                    }
                }
            `, { owner, repo, number: issueNumber });

            const issue = response.repository.issue;
            if (!issue) return null;

            return {
                id: issue.id,
                number: issue.number,
                title: issue.title,
                parent: issue.parent,
                subIssues: issue.subIssues.nodes,
            };
        } catch (error) {
            console.error('Failed to get issue relationships:', error);
            return null;
        }
    }
}

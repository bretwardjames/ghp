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
} from './types';
import type { RepoInfo } from './repo-detector';

/**
 * GitHub API client for Projects V2
 * Uses VS Code's built-in GitHub authentication provider
 */
export class GitHubAPI {
    private graphqlClient: typeof graphql | null = null;
    private currentUser: string | null = null;

    /**
     * Authenticate with GitHub using VS Code's built-in auth provider
     */
    async authenticate(): Promise<boolean> {
        try {
            const session = await vscode.authentication.getSession('github', ['read:project', 'repo'], {
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
                                    __typename
                                    ... on Issue {
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
                                            }
                                        }
                                    }
                                    ... on PullRequest {
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
                                            }
                                        }
                                    }
                                    ... on DraftIssue {
                                        title
                                    }
                                }
                                fieldValues(first: 20) {
                                    nodes {
                                        __typename
                                        ... on ProjectV2ItemFieldSingleSelectValue {
                                            singleSelectName: name
                                            singleSelectField: field {
                                                name
                                            }
                                        }
                                        ... on ProjectV2ItemFieldTextValue {
                                            textValue: text
                                            textField: field {
                                                name
                                            }
                                        }
                                        ... on ProjectV2ItemFieldIterationValue {
                                            iterationTitle: title
                                            iterationField: field {
                                                name
                                            }
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
                    item.assignees.includes(this.currentUser!) ||
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
                                    __typename
                                    ... on ProjectV2SingleSelectField {
                                        id
                                        name
                                        options {
                                            id
                                            name
                                            color
                                        }
                                    }
                                    ... on ProjectV2IterationField {
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
                                        __typename
                                        ... on ProjectV2SingleSelectField {
                                            id
                                            name
                                            options {
                                                id
                                                name
                                                color
                                            }
                                        }
                                        ... on ProjectV2IterationField {
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
            fields(first: 30) {
                nodes {
                    __typename
                    ... on ProjectV2SingleSelectField {
                        id
                        name
                        options {
                            id
                            name
                            color
                        }
                    }
                    ... on ProjectV2IterationField {
                        id
                        name
                    }
                }
            }
            views(first: 20) {
                nodes {
                    id
                    name
                    number
                    layout
                    groupByFields: groupBy(first: 5) {
                        nodes {
                            __typename
                            ... on ProjectV2SingleSelectField {
                                id
                                name
                                options {
                                    id
                                    name
                                    color
                                }
                            }
                            ... on ProjectV2IterationField {
                                id
                                name
                            }
                        }
                    }
                    verticalGroupByFields: verticalGroupBy(first: 5) {
                        nodes {
                            __typename
                            ... on ProjectV2SingleSelectField {
                                id
                                name
                            }
                        }
                    }
                    filter
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

        return projects;
    }

    /**
     * Get the column order for a board view based on the groupBy field options
     */
    getViewColumns(view: ProjectV2View): Array<{ id: string; name: string; color?: string }> {
        const groupByField = view.groupByFields.nodes[0];
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
    private normalizeItem(item: ProjectV2Item, statusFieldName: string): NormalizedProjectItem {
        const fields = new Map<string, string>();
        let status: string | null = null;

        // Extract field values (using aliased field names from GraphQL query)
        for (const fieldValue of item.fieldValues.nodes) {
            if (!fieldValue) continue;

            // Cast through unknown since GraphQL response uses aliased field names
            const fv = fieldValue as unknown as Record<string, unknown>;

            if (fieldValue.__typename === 'ProjectV2ItemFieldSingleSelectValue') {
                const fieldName = (fv.singleSelectField as { name?: string })?.name;
                const valueName = fv.singleSelectName as string;
                if (fieldName && valueName) {
                    fields.set(fieldName, valueName);
                    if (fieldName.toLowerCase() === statusFieldName.toLowerCase()) {
                        status = valueName;
                    }
                }
            } else if (fieldValue.__typename === 'ProjectV2ItemFieldTextValue') {
                const fieldName = (fv.textField as { name?: string })?.name;
                const textValue = fv.textValue as string;
                if (fieldName && textValue) {
                    fields.set(fieldName, textValue);
                }
            } else if (fieldValue.__typename === 'ProjectV2ItemFieldIterationValue') {
                const fieldName = (fv.iterationField as { name?: string })?.name;
                const iterationTitle = fv.iterationTitle as string;
                if (fieldName && iterationTitle) {
                    fields.set(fieldName, iterationTitle);
                }
            }
        }

        const content = item.content;
        const assignees =
            content?.assignees?.nodes.map((a: { login: string }) => a.login) || [];

        let state: 'open' | 'closed' | 'merged' | null = null;
        if (content?.state) {
            state = content.state.toLowerCase() as 'open' | 'closed' | 'merged';
        }

        return {
            id: item.id,
            title: content?.title || 'Untitled',
            type: item.type === 'ISSUE' ? 'issue' : item.type === 'PULL_REQUEST' ? 'pr' : 'draft',
            status,
            url: content?.url || null,
            number: content?.number || null,
            repository: content?.repository
                ? `${content.repository.owner.login}/${content.repository.name}`
                : null,
            assignees,
            state,
            fields,
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
}

import { graphql } from '@octokit/graphql';
import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import type { RepoInfo, ProjectItem, Project, StatusField } from './types.js';

const execAsync = promisify(exec);

/**
 * Check if an error is due to insufficient OAuth scopes
 */
function handleScopeError(error: unknown): never {
    if (error && typeof error === 'object' && 'errors' in error) {
        const gqlError = error as { errors?: Array<{ type?: string; message?: string }> };
        const scopeError = gqlError.errors?.find(e => e.type === 'INSUFFICIENT_SCOPES');
        if (scopeError) {
            console.error(chalk.red('\nError:'), 'Your GitHub token is missing required scopes.');
            console.error(chalk.dim('GitHub Projects requires the'), chalk.cyan('read:project'), chalk.dim('scope.'));
            console.error();
            console.error('Run this command to add the required scope:');
            console.error(chalk.cyan('  gh auth refresh -s read:project -s project'));
            console.error();
            process.exit(1);
        }
    }
    throw error;
}

export class GitHubAPI {
    private graphqlWithAuth: typeof graphql | null = null;
    public username: string | null = null;

    /**
     * Get token from gh CLI or environment variable
     */
    async getToken(): Promise<string | null> {
        // First try environment variable
        if (process.env.GITHUB_TOKEN) {
            return process.env.GITHUB_TOKEN;
        }
        if (process.env.GH_TOKEN) {
            return process.env.GH_TOKEN;
        }

        // Try gh CLI
        try {
            const { stdout } = await execAsync('gh auth token');
            return stdout.trim();
        } catch {
            return null;
        }
    }

    /**
     * Authenticate with GitHub
     */
    async authenticate(): Promise<boolean> {
        const token = await this.getToken();
        if (!token) {
            return false;
        }

        this.graphqlWithAuth = graphql.defaults({
            headers: {
                authorization: `token ${token}`,
            },
        });

        // Get current user
        try {
            const response: { viewer: { login: string } } = await this.graphqlWithAuth(`
                query {
                    viewer {
                        login
                    }
                }
            `);
            this.username = response.viewer.login;
            return true;
        } catch {
            this.graphqlWithAuth = null;
            return false;
        }
    }

    get isAuthenticated(): boolean {
        return this.graphqlWithAuth !== null;
    }

    /**
     * Get projects linked to a repository
     */
    async getProjects(repo: RepoInfo): Promise<Project[]> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        try {
            const response: {
                repository: {
                    projectsV2: {
                        nodes: Array<{
                            id: string;
                            title: string;
                            number: number;
                            url: string;
                        }>;
                    };
                };
            } = await this.graphqlWithAuth(`
                query($owner: String!, $name: String!) {
                    repository(owner: $owner, name: $name) {
                        projectsV2(first: 20) {
                            nodes {
                                id
                                title
                                number
                                url
                            }
                        }
                    }
                }
            `, {
                owner: repo.owner,
                name: repo.name,
            });

            return response.repository.projectsV2.nodes;
        } catch (error) {
            handleScopeError(error);
        }
    }

    /**
     * Get items from a project
     */
    async getProjectItems(projectId: string, projectTitle: string): Promise<ProjectItem[]> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        const response: {
            node: {
                items: {
                    nodes: Array<{
                        id: string;
                        fieldValues: {
                            nodes: Array<{
                                __typename: string;
                                name?: string;
                                text?: string;
                                number?: number;
                                date?: string;
                                title?: string;
                                field?: { name: string };
                            }>;
                        };
                        content: {
                            __typename: string;
                            title?: string;
                            number?: number;
                            url?: string;
                            issueType?: { name: string } | null;
                            assignees?: {
                                nodes: Array<{ login: string }>;
                            };
                            labels?: {
                                nodes: Array<{ name: string; color: string }>;
                            };
                            repository?: { name: string };
                        } | null;
                    }>;
                };
            };
        } = await this.graphqlWithAuth(`
            query($projectId: ID!) {
                node(id: $projectId) {
                    ... on ProjectV2 {
                        items(first: 100) {
                            nodes {
                                id
                                fieldValues(first: 20) {
                                    nodes {
                                        __typename
                                        ... on ProjectV2ItemFieldSingleSelectValue {
                                            name
                                            field { ... on ProjectV2SingleSelectField { name } }
                                        }
                                        ... on ProjectV2ItemFieldTextValue {
                                            text
                                            field { ... on ProjectV2Field { name } }
                                        }
                                        ... on ProjectV2ItemFieldNumberValue {
                                            number
                                            field { ... on ProjectV2Field { name } }
                                        }
                                        ... on ProjectV2ItemFieldDateValue {
                                            date
                                            field { ... on ProjectV2Field { name } }
                                        }
                                        ... on ProjectV2ItemFieldIterationValue {
                                            title
                                            field { ... on ProjectV2IterationField { name } }
                                        }
                                    }
                                }
                                content {
                                    __typename
                                    ... on Issue {
                                        title
                                        number
                                        url
                                        issueType { name }
                                        assignees(first: 5) { nodes { login } }
                                        labels(first: 10) { nodes { name color } }
                                        repository { name }
                                    }
                                    ... on PullRequest {
                                        title
                                        number
                                        url
                                        assignees(first: 5) { nodes { login } }
                                        labels(first: 10) { nodes { name color } }
                                        repository { name }
                                    }
                                    ... on DraftIssue {
                                        title
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `, { projectId });

        return response.node.items.nodes
            .filter(item => item.content)
            .map(item => {
                const content = item.content!;

                // Extract all field values into a map
                const fields: Record<string, string> = {};
                for (const fv of item.fieldValues.nodes) {
                    const fieldName = fv.field?.name;
                    if (!fieldName) continue;

                    if (fv.__typename === 'ProjectV2ItemFieldSingleSelectValue' && fv.name) {
                        fields[fieldName] = fv.name;
                    } else if (fv.__typename === 'ProjectV2ItemFieldTextValue' && fv.text) {
                        fields[fieldName] = fv.text;
                    } else if (fv.__typename === 'ProjectV2ItemFieldNumberValue' && fv.number !== undefined) {
                        fields[fieldName] = fv.number.toString();
                    } else if (fv.__typename === 'ProjectV2ItemFieldDateValue' && fv.date) {
                        fields[fieldName] = fv.date;
                    } else if (fv.__typename === 'ProjectV2ItemFieldIterationValue' && fv.title) {
                        fields[fieldName] = fv.title;
                    }
                }

                let type: 'issue' | 'pull_request' | 'draft' = 'draft';
                if (content.__typename === 'Issue') type = 'issue';
                else if (content.__typename === 'PullRequest') type = 'pull_request';

                return {
                    id: item.id,
                    title: content.title || 'Untitled',
                    number: content.number || null,
                    type,
                    issueType: content.issueType?.name || null,
                    status: fields['Status'] || null,
                    assignees: content.assignees?.nodes.map(a => a.login) || [],
                    labels: content.labels?.nodes || [],
                    repository: content.repository?.name || null,
                    url: content.url || null,
                    projectId,
                    projectTitle,
                    fields,
                };
            });
    }

    /**
     * Get the Status field info for a project
     */
    async getStatusField(projectId: string): Promise<StatusField | null> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        const response: {
            node: {
                fields: {
                    nodes: Array<{
                        __typename: string;
                        id: string;
                        name: string;
                        options?: Array<{ id: string; name: string }>;
                    }>;
                };
            };
        } = await this.graphqlWithAuth(`
            query($projectId: ID!) {
                node(id: $projectId) {
                    ... on ProjectV2 {
                        fields(first: 20) {
                            nodes {
                                __typename
                                ... on ProjectV2SingleSelectField {
                                    id
                                    name
                                    options { id name }
                                }
                            }
                        }
                    }
                }
            }
        `, { projectId });

        const statusField = response.node.fields.nodes.find(
            f => f.__typename === 'ProjectV2SingleSelectField' && f.name === 'Status'
        );

        if (!statusField || !statusField.options) return null;

        return {
            fieldId: statusField.id,
            options: statusField.options,
        };
    }

    /**
     * Update an item's status
     */
    async updateItemStatus(
        projectId: string,
        itemId: string,
        fieldId: string,
        optionId: string
    ): Promise<boolean> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        try {
            await this.graphqlWithAuth(`
                mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
                    updateProjectV2ItemFieldValue(input: {
                        projectId: $projectId
                        itemId: $itemId
                        fieldId: $fieldId
                        value: { singleSelectOptionId: $optionId }
                    }) {
                        projectV2Item { id }
                    }
                }
            `, { projectId, itemId, fieldId, optionId });
            return true;
        } catch (error) {
            console.error('Failed to update status:', error);
            return false;
        }
    }

    /**
     * Find an item by issue number across all projects for this repo
     */
    async findItemByNumber(repo: RepoInfo, issueNumber: number): Promise<ProjectItem | null> {
        const projects = await this.getProjects(repo);

        for (const project of projects) {
            const items = await this.getProjectItems(project.id, project.title);
            const item = items.find(i => i.number === issueNumber);
            if (item) return item;
        }

        return null;
    }

    /**
     * Get all fields for a project
     */
    async getProjectFields(projectId: string): Promise<Array<{
        id: string;
        name: string;
        type: string;
        options?: Array<{ id: string; name: string }>;
    }>> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        const response: {
            node: {
                fields: {
                    nodes: Array<{
                        __typename: string;
                        id: string;
                        name: string;
                        options?: Array<{ id: string; name: string }>;
                    }>;
                };
            };
        } = await this.graphqlWithAuth(`
            query($projectId: ID!) {
                node(id: $projectId) {
                    ... on ProjectV2 {
                        fields(first: 30) {
                            nodes {
                                __typename
                                ... on ProjectV2Field {
                                    id
                                    name
                                }
                                ... on ProjectV2SingleSelectField {
                                    id
                                    name
                                    options { id name }
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
        `, { projectId });

        return response.node.fields.nodes.map(f => ({
            id: f.id,
            name: f.name,
            type: f.__typename.replace('ProjectV2', '').replace('Field', ''),
            options: f.options,
        }));
    }

    /**
     * Set a field value on a project item
     */
    async setFieldValue(
        projectId: string,
        itemId: string,
        fieldId: string,
        value: { text?: string; number?: number; singleSelectOptionId?: string }
    ): Promise<boolean> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        try {
            await this.graphqlWithAuth(`
                mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
                    updateProjectV2ItemFieldValue(input: {
                        projectId: $projectId
                        itemId: $itemId
                        fieldId: $fieldId
                        value: $value
                    }) {
                        projectV2Item { id }
                    }
                }
            `, { projectId, itemId, fieldId, value });
            return true;
        } catch (error) {
            console.error('Failed to set field value:', error);
            return false;
        }
    }

    /**
     * Create a new issue
     */
    async createIssue(repo: RepoInfo, title: string, body?: string): Promise<{ id: string; number: number } | null> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        try {
            // First get the repository ID
            const repoResponse: { repository: { id: string } } = await this.graphqlWithAuth(`
                query($owner: String!, $name: String!) {
                    repository(owner: $owner, name: $name) {
                        id
                    }
                }
            `, { owner: repo.owner, name: repo.name });

            const response: {
                createIssue: {
                    issue: { id: string; number: number };
                };
            } = await this.graphqlWithAuth(`
                mutation($repositoryId: ID!, $title: String!, $body: String) {
                    createIssue(input: {
                        repositoryId: $repositoryId
                        title: $title
                        body: $body
                    }) {
                        issue {
                            id
                            number
                        }
                    }
                }
            `, {
                repositoryId: repoResponse.repository.id,
                title,
                body: body || '',
            });

            return response.createIssue.issue;
        } catch (error) {
            console.error('Failed to create issue:', error);
            return null;
        }
    }

    /**
     * Add an issue to a project
     */
    async addToProject(projectId: string, contentId: string): Promise<string | null> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        try {
            const response: {
                addProjectV2ItemById: { item: { id: string } };
            } = await this.graphqlWithAuth(`
                mutation($projectId: ID!, $contentId: ID!) {
                    addProjectV2ItemById(input: {
                        projectId: $projectId
                        contentId: $contentId
                    }) {
                        item { id }
                    }
                }
            `, { projectId, contentId });

            return response.addProjectV2ItemById.item.id;
        } catch (error) {
            console.error('Failed to add to project:', error);
            return null;
        }
    }

    /**
     * Get full issue details including body and comments
     */
    async getIssueDetails(repo: RepoInfo, issueNumber: number): Promise<IssueDetails | null> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        try {
            const response: {
                repository: {
                    issueOrPullRequest: {
                        __typename: string;
                        title: string;
                        body: string;
                        state: string;
                        createdAt: string;
                        author: { login: string } | null;
                        labels: { nodes: Array<{ name: string; color: string }> };
                        comments: {
                            totalCount: number;
                            nodes: Array<{
                                author: { login: string } | null;
                                body: string;
                                createdAt: string;
                            }>;
                        };
                    } | null;
                };
            } = await this.graphqlWithAuth(`
                query($owner: String!, $name: String!, $number: Int!) {
                    repository(owner: $owner, name: $name) {
                        issueOrPullRequest(number: $number) {
                            __typename
                            ... on Issue {
                                title
                                body
                                state
                                createdAt
                                author { login }
                                labels(first: 10) { nodes { name color } }
                                comments(first: 50) {
                                    totalCount
                                    nodes {
                                        author { login }
                                        body
                                        createdAt
                                    }
                                }
                            }
                            ... on PullRequest {
                                title
                                body
                                state
                                createdAt
                                author { login }
                                labels(first: 10) { nodes { name color } }
                                comments(first: 50) {
                                    totalCount
                                    nodes {
                                        author { login }
                                        body
                                        createdAt
                                    }
                                }
                            }
                        }
                    }
                }
            `, {
                owner: repo.owner,
                name: repo.name,
                number: issueNumber,
            });

            const issue = response.repository.issueOrPullRequest;
            if (!issue) return null;

            return {
                title: issue.title,
                body: issue.body,
                state: issue.state,
                type: issue.__typename === 'PullRequest' ? 'pull_request' : 'issue',
                createdAt: issue.createdAt,
                author: issue.author?.login || 'unknown',
                labels: issue.labels.nodes,
                comments: issue.comments.nodes.map(c => ({
                    author: c.author?.login || 'unknown',
                    body: c.body,
                    createdAt: c.createdAt,
                })),
                totalComments: issue.comments.totalCount,
            };
        } catch (error) {
            console.error('Failed to get issue details:', error);
            return null;
        }
    }

    /**
     * Add a comment to an issue or PR
     */
    async addComment(repo: RepoInfo, issueNumber: number, body: string): Promise<boolean> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        try {
            // First get the issue/PR node ID
            const issueResponse: {
                repository: {
                    issueOrPullRequest: { id: string } | null;
                };
            } = await this.graphqlWithAuth(`
                query($owner: String!, $name: String!, $number: Int!) {
                    repository(owner: $owner, name: $name) {
                        issueOrPullRequest(number: $number) {
                            ... on Issue { id }
                            ... on PullRequest { id }
                        }
                    }
                }
            `, {
                owner: repo.owner,
                name: repo.name,
                number: issueNumber,
            });

            const subjectId = issueResponse.repository.issueOrPullRequest?.id;
            if (!subjectId) {
                console.error('Issue not found');
                return false;
            }

            await this.graphqlWithAuth(`
                mutation($subjectId: ID!, $body: String!) {
                    addComment(input: { subjectId: $subjectId, body: $body }) {
                        commentEdge {
                            node { id }
                        }
                    }
                }
            `, { subjectId, body });

            return true;
        } catch (error) {
            console.error('Failed to add comment:', error);
            return false;
        }
    }

    /**
     * Get repository collaborators (for @ mention suggestions)
     */
    async getCollaborators(repo: RepoInfo): Promise<Collaborator[]> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        try {
            const response: {
                repository: {
                    collaborators: {
                        nodes: Array<{ login: string; name: string | null }>;
                    } | null;
                    assignableUsers: {
                        nodes: Array<{ login: string; name: string | null }>;
                    };
                };
            } = await this.graphqlWithAuth(`
                query($owner: String!, $name: String!) {
                    repository(owner: $owner, name: $name) {
                        collaborators(first: 50) {
                            nodes { login name }
                        }
                        assignableUsers(first: 50) {
                            nodes { login name }
                        }
                    }
                }
            `, { owner: repo.owner, name: repo.name });

            // Use collaborators if available, fall back to assignable users
            const users = response.repository.collaborators?.nodes
                || response.repository.assignableUsers.nodes
                || [];

            return users.map(u => ({ login: u.login, name: u.name }));
        } catch {
            // Collaborators might not be accessible, return empty
            return [];
        }
    }

    /**
     * Get recent issues (for # reference suggestions)
     */
    async getRecentIssues(repo: RepoInfo, limit: number = 20): Promise<IssueReference[]> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        try {
            const response: {
                repository: {
                    issues: {
                        nodes: Array<{
                            number: number;
                            title: string;
                            state: string;
                        }>;
                    };
                };
            } = await this.graphqlWithAuth(`
                query($owner: String!, $name: String!, $limit: Int!) {
                    repository(owner: $owner, name: $name) {
                        issues(first: $limit, orderBy: { field: UPDATED_AT, direction: DESC }) {
                            nodes {
                                number
                                title
                                state
                            }
                        }
                    }
                }
            `, { owner: repo.owner, name: repo.name, limit });

            return response.repository.issues.nodes;
        } catch {
            return [];
        }
    }
}

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

export interface Collaborator {
    login: string;
    name: string | null;
}

export interface IssueReference {
    number: number;
    title: string;
    state: string;
}

// Singleton instance
export const api = new GitHubAPI();

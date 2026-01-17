/**
 * GitHub API client for Projects V2.
 *
 * This class is auth-agnostic - it uses a TokenProvider interface to get
 * authentication tokens, making it work with both CLI and IDE environments.
 *
 * @example CLI usage:
 * ```typescript
 * const api = new GitHubAPI({
 *   tokenProvider: {
 *     async getToken() {
 *       const { stdout } = await exec('gh auth token');
 *       return stdout.trim();
 *     }
 *   },
 *   onAuthError: (err) => { console.error(err.message); process.exit(1); }
 * });
 * ```
 *
 * @example VSCode usage:
 * ```typescript
 * const api = new GitHubAPI({
 *   tokenProvider: {
 *     async getToken() {
 *       const session = await vscode.authentication.getSession('github', ['project']);
 *       return session?.accessToken ?? null;
 *     }
 *   }
 * });
 * ```
 */

import { graphql } from '@octokit/graphql';
import type {
    TokenProvider,
    GitHubAPIOptions,
    AuthError,
    RepoInfo,
    Project,
    ProjectItem,
    StatusField,
    IssueDetails,
    Collaborator,
    IssueReference,
} from './types.js';
import * as queries from './queries.js';

/**
 * Create an AuthError with the appropriate type
 */
function createAuthError(
    message: string,
    type: AuthError['type'],
    details?: { requiredScopes?: string[]; ssoUrl?: string }
): AuthError {
    const error = new Error(message) as AuthError;
    error.type = type;
    error.requiredScopes = details?.requiredScopes;
    error.ssoUrl = details?.ssoUrl;
    return error;
}

/**
 * Check if an error is due to insufficient OAuth scopes or other auth issues
 */
function checkAuthError(error: unknown): AuthError | null {
    if (error && typeof error === 'object' && 'errors' in error) {
        const gqlError = error as { errors?: Array<{ type?: string; message?: string }> };

        const scopeError = gqlError.errors?.find(e => e.type === 'INSUFFICIENT_SCOPES');
        if (scopeError) {
            return createAuthError(
                'Your GitHub token is missing required scopes. GitHub Projects requires the read:project scope.',
                'INSUFFICIENT_SCOPES',
                { requiredScopes: ['read:project', 'project'] }
            );
        }

        const ssoError = gqlError.errors?.find(e =>
            e.message?.includes('SSO') || e.message?.includes('SAML')
        );
        if (ssoError) {
            return createAuthError(
                'SSO authentication required for this organization.',
                'SSO_REQUIRED'
            );
        }
    }

    return null;
}

export class GitHubAPI {
    private graphqlWithAuth: typeof graphql | null = null;
    private tokenProvider: TokenProvider;
    private onAuthError?: (error: AuthError) => void;
    public username: string | null = null;

    constructor(options: GitHubAPIOptions) {
        this.tokenProvider = options.tokenProvider;
        this.onAuthError = options.onAuthError;
    }

    /**
     * Handle authentication errors by calling the error handler or throwing
     */
    private handleAuthError(error: unknown): never {
        const authError = checkAuthError(error);
        if (authError) {
            if (this.onAuthError) {
                this.onAuthError(authError);
            }
            throw authError;
        }
        throw error;
    }

    /**
     * Authenticate with GitHub using the token provider
     */
    async authenticate(): Promise<boolean> {
        const token = await this.tokenProvider.getToken();
        if (!token) {
            return false;
        }

        this.graphqlWithAuth = graphql.defaults({
            headers: {
                authorization: `token ${token}`,
            },
        });

        try {
            const response: { viewer: { login: string } } =
                await this.graphqlWithAuth(queries.VIEWER_QUERY);
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
     * Get the current token (for REST API calls)
     */
    async getToken(): Promise<string | null> {
        return this.tokenProvider.getToken();
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
            } = await this.graphqlWithAuth(queries.REPOSITORY_PROJECTS_QUERY, {
                owner: repo.owner,
                name: repo.name,
            });

            return response.repository.projectsV2.nodes;
        } catch (error) {
            this.handleAuthError(error);
        }
    }

    /**
     * Get items from a project
     */
    async getProjectItems(projectId: string, projectTitle: string): Promise<ProjectItem[]> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        // First, get the status field to build a status order map
        const statusField = await this.getStatusField(projectId);
        const statusOrderMap = new Map<string, number>();
        if (statusField) {
            statusField.options.forEach((opt, idx) => {
                statusOrderMap.set(opt.name.toLowerCase(), idx);
            });
        }

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
                            state?: string;
                            merged?: boolean;
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
        } = await this.graphqlWithAuth(queries.PROJECT_ITEMS_QUERY, { projectId });

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

                const status = fields['Status'] || null;
                const statusIndex = status
                    ? (statusOrderMap.get(status.toLowerCase()) ?? 999)
                    : 999;

                // Determine issue/PR state
                let state: 'open' | 'closed' | 'merged' | null = null;
                if (content.state) {
                    if (content.merged) {
                        state = 'merged';
                    } else if (content.state === 'OPEN') {
                        state = 'open';
                    } else {
                        state = 'closed';
                    }
                }

                return {
                    id: item.id,
                    title: content.title || 'Untitled',
                    number: content.number || null,
                    type,
                    issueType: content.issueType?.name || null,
                    status,
                    statusIndex,
                    state,
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
        } = await this.graphqlWithAuth(queries.PROJECT_FIELDS_QUERY, { projectId });

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
     * Get project views
     */
    async getProjectViews(projectId: string): Promise<Array<{ name: string; filter: string | null }>> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        try {
            const response: {
                node: {
                    views: {
                        nodes: Array<{
                            name: string;
                            filter: string | null;
                        }>;
                    };
                };
            } = await this.graphqlWithAuth(queries.PROJECT_VIEWS_QUERY, { projectId });

            return response.node.views.nodes;
        } catch {
            return [];
        }
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
            await this.graphqlWithAuth(queries.UPDATE_ITEM_STATUS_MUTATION, {
                projectId,
                itemId,
                fieldId,
                optionId,
            });
            return true;
        } catch {
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
        } = await this.graphqlWithAuth(queries.PROJECT_FIELDS_QUERY, { projectId });

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
            await this.graphqlWithAuth(queries.UPDATE_ITEM_FIELD_MUTATION, {
                projectId,
                itemId,
                fieldId,
                value,
            });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Create a new issue
     */
    async createIssue(
        repo: RepoInfo,
        title: string,
        body?: string
    ): Promise<{ id: string; number: number } | null> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        try {
            // First get the repository ID
            const repoResponse: { repository: { id: string } } =
                await this.graphqlWithAuth(queries.REPOSITORY_ID_QUERY, {
                    owner: repo.owner,
                    name: repo.name,
                });

            const response: {
                createIssue: {
                    issue: { id: string; number: number };
                };
            } = await this.graphqlWithAuth(queries.CREATE_ISSUE_MUTATION, {
                repositoryId: repoResponse.repository.id,
                title,
                body: body || '',
            });

            return response.createIssue.issue;
        } catch {
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
            } = await this.graphqlWithAuth(queries.ADD_TO_PROJECT_MUTATION, {
                projectId,
                contentId,
            });

            return response.addProjectV2ItemById.item.id;
        } catch {
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
            } = await this.graphqlWithAuth(queries.ISSUE_DETAILS_QUERY, {
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
        } catch {
            return null;
        }
    }

    /**
     * Add a comment to an issue or PR
     */
    async addComment(repo: RepoInfo, issueNumber: number, body: string): Promise<boolean> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        try {
            const issueResponse: {
                repository: {
                    issueOrPullRequest: { id: string } | null;
                };
            } = await this.graphqlWithAuth(queries.ISSUE_NODE_ID_QUERY, {
                owner: repo.owner,
                name: repo.name,
                number: issueNumber,
            });

            const subjectId = issueResponse.repository.issueOrPullRequest?.id;
            if (!subjectId) {
                return false;
            }

            await this.graphqlWithAuth(queries.ADD_COMMENT_MUTATION, { subjectId, body });
            return true;
        } catch {
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
            } = await this.graphqlWithAuth(queries.COLLABORATORS_QUERY, {
                owner: repo.owner,
                name: repo.name,
            });

            const users = response.repository.collaborators?.nodes
                || response.repository.assignableUsers.nodes
                || [];

            return users.map(u => ({ login: u.login, name: u.name }));
        } catch {
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
            } = await this.graphqlWithAuth(queries.RECENT_ISSUES_QUERY, {
                owner: repo.owner,
                name: repo.name,
                limit,
            });

            return response.repository.issues.nodes;
        } catch {
            return [];
        }
    }

    /**
     * Get the active label name for a user
     */
    getActiveLabelName(): string {
        return `@${this.username}:active`;
    }

    /**
     * Ensure a label exists in the repository, create if it doesn't
     */
    async ensureLabel(repo: RepoInfo, labelName: string, color: string = '1f883d'): Promise<boolean> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        try {
            const checkResponse: {
                repository: {
                    label: { id: string } | null;
                };
            } = await this.graphqlWithAuth(queries.LABEL_EXISTS_QUERY, {
                owner: repo.owner,
                name: repo.name,
                labelName,
            });

            if (checkResponse.repository.label) {
                return true;
            }

            // Create the label using REST API
            const token = await this.getToken();
            const response = await fetch(
                `https://api.github.com/repos/${repo.owner}/${repo.name}/labels`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `token ${token}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/vnd.github.v3+json',
                    },
                    body: JSON.stringify({
                        name: labelName,
                        color: color,
                        description: `Active working indicator for ${this.username}`,
                    }),
                }
            );

            return response.status === 201 || response.status === 422;
        } catch {
            return false;
        }
    }

    /**
     * Add a label to an issue
     */
    async addLabelToIssue(repo: RepoInfo, issueNumber: number, labelName: string): Promise<boolean> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        try {
            const response: {
                repository: {
                    issue: { id: string } | null;
                    label: { id: string } | null;
                };
            } = await this.graphqlWithAuth(queries.ISSUE_AND_LABEL_QUERY, {
                owner: repo.owner,
                name: repo.name,
                number: issueNumber,
                labelName,
            });

            if (!response.repository.issue || !response.repository.label) {
                return false;
            }

            await this.graphqlWithAuth(queries.ADD_LABELS_MUTATION, {
                issueId: response.repository.issue.id,
                labelIds: [response.repository.label.id],
            });

            return true;
        } catch {
            return false;
        }
    }

    /**
     * Remove a label from an issue
     */
    async removeLabelFromIssue(repo: RepoInfo, issueNumber: number, labelName: string): Promise<boolean> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        try {
            const response: {
                repository: {
                    issue: { id: string } | null;
                    label: { id: string } | null;
                };
            } = await this.graphqlWithAuth(queries.ISSUE_AND_LABEL_QUERY, {
                owner: repo.owner,
                name: repo.name,
                number: issueNumber,
                labelName,
            });

            if (!response.repository.issue || !response.repository.label) {
                return false;
            }

            await this.graphqlWithAuth(queries.REMOVE_LABELS_MUTATION, {
                issueId: response.repository.issue.id,
                labelIds: [response.repository.label.id],
            });

            return true;
        } catch {
            return false;
        }
    }

    /**
     * Find all issues with a specific label
     */
    async findIssuesWithLabel(repo: RepoInfo, labelName: string): Promise<number[]> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        try {
            const response: {
                repository: {
                    issues: {
                        nodes: Array<{ number: number }>;
                    };
                };
            } = await this.graphqlWithAuth(queries.ISSUES_WITH_LABEL_QUERY, {
                owner: repo.owner,
                name: repo.name,
                labels: [labelName],
            });

            return response.repository.issues.nodes.map(i => i.number);
        } catch {
            return [];
        }
    }

    /**
     * Get available issue types for a repository
     */
    async getIssueTypes(repo: RepoInfo): Promise<Array<{ id: string; name: string }>> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        try {
            const response: {
                repository: {
                    issueTypes: {
                        nodes: Array<{ id: string; name: string }>;
                    } | null;
                };
            } = await this.graphqlWithAuth(queries.ISSUE_TYPES_QUERY, {
                owner: repo.owner,
                name: repo.name,
            });

            return response.repository.issueTypes?.nodes || [];
        } catch {
            return [];
        }
    }

    /**
     * Set the issue type on an issue
     */
    async setIssueType(repo: RepoInfo, issueNumber: number, issueTypeId: string): Promise<boolean> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        try {
            const issueResponse: {
                repository: {
                    issue: { id: string } | null;
                };
            } = await this.graphqlWithAuth(queries.ISSUE_FOR_UPDATE_QUERY, {
                owner: repo.owner,
                name: repo.name,
                number: issueNumber,
            });

            if (!issueResponse.repository.issue) {
                return false;
            }

            await this.graphqlWithAuth(queries.UPDATE_ISSUE_TYPE_MUTATION, {
                issueId: issueResponse.repository.issue.id,
                issueTypeId,
            });

            return true;
        } catch {
            return false;
        }
    }

    /**
     * Update an issue's body/description
     */
    async updateIssueBody(repo: RepoInfo, issueNumber: number, body: string): Promise<boolean> {
        if (!this.graphqlWithAuth) throw new Error('Not authenticated');

        try {
            const issueResponse: {
                repository: {
                    issue: { id: string } | null;
                };
            } = await this.graphqlWithAuth(queries.ISSUE_FOR_UPDATE_QUERY, {
                owner: repo.owner,
                name: repo.name,
                number: issueNumber,
            });

            if (!issueResponse.repository.issue) {
                return false;
            }

            await this.graphqlWithAuth(queries.UPDATE_ISSUE_BODY_MUTATION, {
                issueId: issueResponse.repository.issue.id,
                body,
            });

            return true;
        } catch {
            return false;
        }
    }
}

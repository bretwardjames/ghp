import * as vscode from 'vscode';
import { GitHubAPI } from './vscode-github-api';
import type { NormalizedProjectItem, ProjectWithViews } from './types';

interface IssueComment {
    id: string;
    author: string;
    body: string;
    createdAt: string;
    authorAvatarUrl?: string;
}

interface ProjectField {
    id: string;
    name: string;
    currentValue: string | null;
    options: Array<{ id: string; name: string }>;
}

interface IssueDetails {
    title: string;
    body: string;
    state: string;
    number: number;
    url: string;
    author: string;
    createdAt: string;
    labels: string[];
    comments: IssueComment[];
    assignees: string[];
    projectFields: ProjectField[];
    issueType: string | null;
    // Parent/child relationships
    parent: { number: number; title: string; state: string } | null;
    subIssues: Array<{ number: number; title: string; state: string }>;
}

export class IssueDetailPanel {
    public static currentPanel: IssueDetailPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _api: GitHubAPI;
    private _item: NormalizedProjectItem;
    private _project: ProjectWithViews;
    private _disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        api: GitHubAPI,
        item: NormalizedProjectItem,
        project: ProjectWithViews
    ) {
        this._panel = panel;
        this._api = api;
        this._item = item;
        this._project = project;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            (message) => this._handleMessage(message),
            null,
            this._disposables
        );

        this._loadAndRender();
    }

    public static async show(
        api: GitHubAPI,
        item: NormalizedProjectItem,
        project: ProjectWithViews
    ): Promise<void> {
        const column = vscode.ViewColumn.Beside;

        if (IssueDetailPanel.currentPanel) {
            IssueDetailPanel.currentPanel._item = item;
            IssueDetailPanel.currentPanel._project = project;
            IssueDetailPanel.currentPanel._panel.reveal(column);
            await IssueDetailPanel.currentPanel._loadAndRender();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'issueDetail',
            `#${item.number} ${item.title}`,
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        IssueDetailPanel.currentPanel = new IssueDetailPanel(panel, api, item, project);
    }

    private async _loadAndRender(): Promise<void> {
        this._panel.title = `#${this._item.number} ${this._item.title}`;
        this._panel.webview.html = this._getLoadingHtml();

        try {
            const details = await this._fetchIssueDetails();
            this._panel.webview.html = this._getHtml(details);
        } catch (error) {
            this._panel.webview.html = this._getErrorHtml(
                error instanceof Error ? error.message : 'Failed to load issue'
            );
        }
    }

    private async _fetchIssueDetails(): Promise<IssueDetails> {
        const client = this._api.getGraphQLClient();
        if (!client) {
            throw new Error('Not authenticated');
        }

        // Parse owner/repo from item.repository
        const [owner, repo] = (this._item.repository || '').split('/');
        if (!owner || !repo || !this._item.number) {
            throw new Error('Invalid issue reference');
        }

        const isIssue = this._item.type === 'issue';
        const query = isIssue ? `
            query($owner: String!, $repo: String!, $number: Int!) {
                repository(owner: $owner, name: $repo) {
                    issue(number: $number) {
                        title
                        body
                        state
                        number
                        url
                        createdAt
                        issueType {
                            name
                        }
                        author {
                            login
                            avatarUrl
                        }
                        labels(first: 10) {
                            nodes {
                                name
                            }
                        }
                        comments(first: 50) {
                            nodes {
                                id
                                body
                                createdAt
                                author {
                                    login
                                    avatarUrl
                                }
                            }
                        }
                    }
                }
            }
        ` : `
            query($owner: String!, $repo: String!, $number: Int!) {
                repository(owner: $owner, name: $repo) {
                    pullRequest(number: $number) {
                        title
                        body
                        state
                        number
                        url
                        createdAt
                        author {
                            login
                            avatarUrl
                        }
                        labels(first: 10) {
                            nodes {
                                name
                            }
                        }
                        comments(first: 50) {
                            nodes {
                                id
                                body
                                createdAt
                                author {
                                    login
                                    avatarUrl
                                }
                            }
                        }
                    }
                }
            }
        `;

        const response = await client<{
            repository: {
                issue?: {
                    title: string;
                    body: string;
                    state: string;
                    number: number;
                    url: string;
                    createdAt: string;
                    issueType: { name: string } | null;
                    author: { login: string; avatarUrl: string };
                    labels: { nodes: Array<{ name: string }> };
                    comments: {
                        nodes: Array<{
                            id: string;
                            body: string;
                            createdAt: string;
                            author: { login: string; avatarUrl: string };
                        }>;
                    };
                };
                pullRequest?: {
                    title: string;
                    body: string;
                    state: string;
                    number: number;
                    url: string;
                    createdAt: string;
                    author: { login: string; avatarUrl: string };
                    labels: { nodes: Array<{ name: string }> };
                    comments: {
                        nodes: Array<{
                            id: string;
                            body: string;
                            createdAt: string;
                            author: { login: string; avatarUrl: string };
                        }>;
                    };
                };
            };
        }>(query, { owner, repo, number: this._item.number });

        const data = response.repository.issue || response.repository.pullRequest;
        if (!data) {
            throw new Error('Issue not found');
        }

        // Get all project fields with their options
        const allFields = await this._api.getProjectFields(this._project.id);

        // Map fields to include current values from the item
        // Note: fields are stored with lowercase keys in normalizeItem
        // Skip Status field - it's shown as a badge elsewhere
        const projectFields: ProjectField[] = allFields
            .filter((field) => field.name.toLowerCase() !== 'status')
            .map((field) => {
                const fieldInfo = this._item.fields.get(field.name.toLowerCase());
                return {
                    id: field.id,
                    name: field.name,
                    currentValue: fieldInfo?.value || null,
                    options: field.options || [],
                };
            });

        // Get issue type (only available on issues, not PRs)
        const issueData = response.repository.issue;
        const issueType = issueData?.issueType?.name || null;

        // Fetch parent/child relationships for issues
        let parent: { number: number; title: string; state: string } | null = null;
        let subIssues: Array<{ number: number; title: string; state: string }> = [];

        if (isIssue && this._item.number) {
            const relationships = await this._api.getIssueRelationships(
                owner,
                repo,
                this._item.number
            );
            if (relationships) {
                parent = relationships.parent;
                subIssues = relationships.subIssues;
            }
        }

        return {
            title: data.title,
            body: data.body || '',
            state: data.state,
            number: data.number,
            url: data.url,
            author: data.author?.login || 'unknown',
            createdAt: data.createdAt,
            labels: data.labels.nodes.map((l) => l.name),
            assignees: this._item.assignees.map((a) => a.login),
            comments: data.comments.nodes.map((c) => ({
                id: c.id,
                author: c.author?.login || 'unknown',
                body: c.body,
                createdAt: c.createdAt,
                authorAvatarUrl: c.author?.avatarUrl,
            })),
            projectFields,
            issueType,
            parent,
            subIssues,
        };
    }

    private async _handleMessage(message: { type: string; [key: string]: unknown }): Promise<void> {
        switch (message.type) {
            case 'addComment':
                await this._addComment(message.body as string);
                break;
            case 'changeField':
                await this._changeField(
                    message.fieldId as string,
                    message.fieldName as string,
                    message.optionId as string,
                    message.optionName as string
                );
                break;
            case 'editAssignees':
                await this._editAssignees();
                break;
            case 'saveDescription':
                await this._editDescription(message.newBody as string);
                break;
            case 'openInBrowser':
                if (this._item.url) {
                    vscode.env.openExternal(vscode.Uri.parse(this._item.url));
                }
                break;
            case 'refresh':
                await this._loadAndRender();
                break;
            case 'setParent':
                await this._setParent();
                break;
            case 'removeParent':
                await this._removeParent();
                break;
            case 'addChild':
                await this._addChild();
                break;
            case 'openIssue':
                await this._openRelatedIssue(message.number as number);
                break;
        }
    }

    private async _editAssignees(): Promise<void> {
        const [owner, repo] = (this._item.repository || '').split('/');
        if (!owner || !repo || !this._item.number) {
            vscode.window.showErrorMessage('Cannot edit assignees for this item');
            return;
        }

        try {
            // Get collaborators for suggestions
            const collaborators = await this._api.getCollaboratorsByOwnerRepo(owner, repo);
            const currentLogins = this._item.assignees.map((a) => a.login);

            // Show quick pick with multi-select
            const items = collaborators.map((c) => ({
                label: c.login,
                picked: currentLogins.includes(c.login),
            }));

            // If current assignees aren't in collaborators list, add them
            for (const login of currentLogins) {
                if (!items.some((i) => i.label === login)) {
                    items.unshift({ label: login, picked: true });
                }
            }

            const selected = await vscode.window.showQuickPick(items, {
                canPickMany: true,
                placeHolder: 'Select assignees',
                title: 'Edit Assignees',
            });

            if (selected !== undefined) {
                const newAssignees = selected.map((s) => s.label);
                await this._api.updateAssignees(
                    owner,
                    repo,
                    this._item.number,
                    newAssignees,
                    this._item.type === 'pr' ? 'pr' : 'issue'
                );

                // Update local state with AssigneeInfo structure
                this._item.assignees = newAssignees.map((login) => ({ login, avatarUrl: null }));
                vscode.window.showInformationMessage('Assignees updated');
                await this._loadAndRender();
                vscode.commands.executeCommand('ghProjects.refresh');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to update assignees: ${error}`);
        }
    }

    private async _editDescription(newBody: string): Promise<void> {
        const [owner, repo] = (this._item.repository || '').split('/');
        if (!owner || !repo || !this._item.number) {
            vscode.window.showErrorMessage('Cannot edit description for this item');
            return;
        }

        // Only issues can have their body edited (not PRs)
        if (this._item.type !== 'issue') {
            vscode.window.showWarningMessage('Only issue descriptions can be edited from here');
            return;
        }

        try {
            await this._api.updateIssueBody(owner, repo, this._item.number, newBody);
            vscode.window.showInformationMessage('Description updated');
            await this._loadAndRender();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to update description: ${error}`);
        }
    }


    private async _setParent(): Promise<void> {
        const [owner, repo] = (this._item.repository || '').split('/');
        if (!owner || !repo || !this._item.number) {
            vscode.window.showErrorMessage('Cannot set parent for this item');
            return;
        }

        const parentNumberStr = await vscode.window.showInputBox({
            prompt: `Enter parent issue number for #${this._item.number}`,
            placeHolder: 'e.g., 42',
            validateInput: (value) => {
                const num = parseInt(value, 10);
                if (isNaN(num) || num <= 0) {
                    return 'Please enter a valid issue number';
                }
                if (num === this._item.number) {
                    return 'An issue cannot be its own parent';
                }
                return null;
            },
        });

        if (!parentNumberStr) {
            return;
        }

        const parentNumber = parseInt(parentNumberStr, 10);

        try {
            const success = await this._api.addSubIssue(owner, repo, parentNumber, this._item.number!);
            if (success) {
                vscode.window.showInformationMessage(`Linked #${this._item.number} as sub-issue of #${parentNumber}`);
                await this._loadAndRender();
            } else {
                vscode.window.showErrorMessage('Failed to set parent issue');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to set parent: ${error}`);
        }
    }

    private async _removeParent(): Promise<void> {
        const [owner, repo] = (this._item.repository || '').split('/');
        if (!owner || !repo || !this._item.number) {
            vscode.window.showErrorMessage('Cannot remove parent for this item');
            return;
        }

        const relationships = await this._api.getIssueRelationships(owner, repo, this._item.number);
        if (!relationships || !relationships.parent) {
            vscode.window.showInformationMessage(`Issue #${this._item.number} has no parent`);
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Remove #${this._item.number} from parent #${relationships.parent.number}?`,
            'Remove',
            'Cancel'
        );

        if (confirm === 'Remove') {
            try {
                const success = await this._api.removeSubIssue(
                    owner,
                    repo,
                    relationships.parent.number,
                    this._item.number!
                );
                if (success) {
                    vscode.window.showInformationMessage(
                        `Removed #${this._item.number} from parent #${relationships.parent.number}`
                    );
                    await this._loadAndRender();
                } else {
                    vscode.window.showErrorMessage('Failed to remove parent');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to remove parent: ${error}`);
            }
        }
    }

    private async _addChild(): Promise<void> {
        const [owner, repo] = (this._item.repository || '').split('/');
        if (!owner || !repo || !this._item.number) {
            vscode.window.showErrorMessage('Cannot add child to this item');
            return;
        }

        const childNumberStr = await vscode.window.showInputBox({
            prompt: `Enter issue number to add as child of #${this._item.number}`,
            placeHolder: 'e.g., 42',
            validateInput: (value) => {
                const num = parseInt(value, 10);
                if (isNaN(num) || num <= 0) {
                    return 'Please enter a valid issue number';
                }
                if (num === this._item.number) {
                    return 'An issue cannot be its own child';
                }
                return null;
            },
        });

        if (!childNumberStr) {
            return;
        }

        const childNumber = parseInt(childNumberStr, 10);

        try {
            const success = await this._api.addSubIssue(owner, repo, this._item.number!, childNumber);
            if (success) {
                vscode.window.showInformationMessage(`Added #${childNumber} as sub-issue of #${this._item.number}`);
                await this._loadAndRender();
            } else {
                vscode.window.showErrorMessage('Failed to add child issue');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to add child: ${error}`);
        }
    }

    private async _openRelatedIssue(issueNumber: number): Promise<void> {
        // Find the issue in the project items and open its detail panel
        // For now, just open in browser as we don't have direct access to other items
        const [owner, repo] = (this._item.repository || '').split('/');
        if (owner && repo) {
            const url = `https://github.com/${owner}/${repo}/issues/${issueNumber}`;
            vscode.env.openExternal(vscode.Uri.parse(url));
        }
    }

    private async _changeField(fieldId: string, fieldName: string, optionId: string, optionName: string): Promise<void> {
        try {
            const success = await this._api.updateItemField(
                this._project.id,
                this._item.id,
                fieldId,
                optionId
            );

            if (success) {
                // Update local state with FieldInfo structure (lowercase key to match normalizeItem)
                this._item.fields.set(fieldName.toLowerCase(), { value: optionName, color: null });
                if (fieldName.toLowerCase() === 'status') {
                    this._item.status = optionName;
                }
                vscode.window.showInformationMessage(`${fieldName} changed to "${optionName}"`);
                await this._loadAndRender();
                vscode.commands.executeCommand('ghProjects.refresh');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to update ${fieldName}: ${error}`);
        }
    }

    private async _addComment(body: string): Promise<void> {
        if (!body.trim()) return;

        const client = this._api.getGraphQLClient();
        if (!client) return;

        const [owner, repo] = (this._item.repository || '').split('/');
        if (!owner || !repo || !this._item.number) return;

        try {
            // First get the issue/PR node ID
            const idQuery = this._item.type === 'issue' ? `
                query($owner: String!, $repo: String!, $number: Int!) {
                    repository(owner: $owner, name: $repo) {
                        issue(number: $number) {
                            id
                        }
                    }
                }
            ` : `
                query($owner: String!, $repo: String!, $number: Int!) {
                    repository(owner: $owner, name: $repo) {
                        pullRequest(number: $number) {
                            id
                        }
                    }
                }
            `;

            const idResponse = await client<{
                repository: {
                    issue?: { id: string };
                    pullRequest?: { id: string };
                };
            }>(idQuery, { owner, repo, number: this._item.number });

            const subjectId = idResponse.repository.issue?.id || idResponse.repository.pullRequest?.id;
            if (!subjectId) return;

            // Add the comment
            await client(`
                mutation($subjectId: ID!, $body: String!) {
                    addComment(input: { subjectId: $subjectId, body: $body }) {
                        commentEdge {
                            node {
                                id
                            }
                        }
                    }
                }
            `, { subjectId, body });

            vscode.window.showInformationMessage('Comment added');
            await this._loadAndRender();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to add comment: ${error}`);
        }
    }

    private _getLoadingHtml(): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        padding: 20px;
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                    }
                    .loading {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                    }
                </style>
            </head>
            <body>
                <div class="loading">
                    <span>Loading issue details...</span>
                </div>
            </body>
            </html>
        `;
    }

    private _getErrorHtml(message: string): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        padding: 20px;
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                    }
                    .error {
                        color: var(--vscode-errorForeground);
                        padding: 10px;
                        border: 1px solid var(--vscode-errorForeground);
                        border-radius: 4px;
                    }
                </style>
            </head>
            <body>
                <div class="error">
                    <strong>Error:</strong> ${this._escapeHtml(message)}
                </div>
            </body>
            </html>
        `;
    }

    private _getHtml(details: IssueDetails): string {
        const commentsHtml = details.comments
            .map((c) => `
                <div class="comment">
                    <div class="comment-header">
                        <strong>${this._escapeHtml(c.author)}</strong>
                        <span class="date">${this._formatDate(c.createdAt)}</span>
                    </div>
                    <div class="comment-body">${this._renderMarkdown(c.body)}</div>
                </div>
            `)
            .join('');

        const labelsHtml = details.labels
            .map((l) => `<span class="label">${this._escapeHtml(l)}</span>`)
            .join('');

        const issueTypeHtml = details.issueType
            ? `<span class="issue-type">${this._escapeHtml(details.issueType)}</span>`
            : '';

        const assigneesHtml = details.assignees.length > 0
            ? details.assignees.map((a) => `<span class="assignee">${this._escapeHtml(a)}</span>`).join('')
            : '<span class="no-assignee">Unassigned</span>';

        // Generate field dropdowns
        const fieldsHtml = details.projectFields
            .map((field) => {
                const optionsHtml = field.options
                    .map((opt) => `<option value="${this._escapeHtml(opt.id)}" data-name="${this._escapeHtml(opt.name)}" ${opt.name === field.currentValue ? 'selected' : ''}>${this._escapeHtml(opt.name)}</option>`)
                    .join('');
                return `
                    <div class="field-row">
                        <label class="field-label">${this._escapeHtml(field.name)}</label>
                        <select class="field-select" data-field-id="${this._escapeHtml(field.id)}" data-field-name="${this._escapeHtml(field.name)}" onchange="changeField(this)">
                            <option value="">-- None --</option>
                            ${optionsHtml}
                        </select>
                    </div>
                `;
            })
            .join('');

        // Generate parent/child relationships HTML
        const parentHtml = details.parent
            ? `
                <div class="relationship-item parent">
                    <span class="relation-icon">↑</span>
                    <a href="#" onclick="openIssue(${details.parent.number}); return false;">
                        #${details.parent.number}
                    </a>
                    <span class="relation-title">${this._escapeHtml(details.parent.title)}</span>
                    ${details.parent.state === 'CLOSED' ? '<span class="state-closed">✓</span>' : ''}
                </div>
            `
            : '';

        const subIssuesHtml = details.subIssues.length > 0
            ? details.subIssues.map(sub => `
                <div class="relationship-item child">
                    <span class="relation-icon">↓</span>
                    <a href="#" onclick="openIssue(${sub.number}); return false;">
                        #${sub.number}
                    </a>
                    <span class="relation-title">${this._escapeHtml(sub.title)}</span>
                    ${sub.state === 'CLOSED' ? '<span class="state-closed">✓</span>' : ''}
                </div>
            `).join('')
            : '';

        const hasRelationships = details.parent || details.subIssues.length > 0;
        const completedCount = details.subIssues.filter(s => s.state === 'CLOSED').length;
        const totalCount = details.subIssues.length;
        const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        padding: 20px;
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                        line-height: 1.5;
                    }
                    .header {
                        margin-bottom: 20px;
                        padding-bottom: 15px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    .header-top {
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-start;
                    }
                    .title {
                        font-size: 1.4em;
                        font-weight: bold;
                        margin: 0 0 5px 0;
                    }
                    .meta {
                        color: var(--vscode-descriptionForeground);
                        font-size: 0.9em;
                    }
                    .actions {
                        display: flex;
                        gap: 10px;
                        align-items: center;
                    }
                    .btn {
                        padding: 5px 15px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                    }
                    .btn:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    .btn-secondary {
                        background: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                    }
                    .labels, .assignees {
                        display: flex;
                        gap: 5px;
                        flex-wrap: wrap;
                        margin: 10px 0;
                    }
                    .label {
                        padding: 2px 8px;
                        background: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                        border-radius: 10px;
                        font-size: 0.85em;
                    }
                    .issue-type {
                        padding: 2px 8px;
                        background: var(--vscode-statusBarItem-prominentBackground, #5a21b5);
                        color: var(--vscode-statusBarItem-prominentForeground, #ffffff);
                        border-radius: 10px;
                        font-size: 0.85em;
                        font-weight: 500;
                    }
                    .assignee {
                        padding: 2px 8px;
                        background: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                        border-radius: 10px;
                        font-size: 0.85em;
                    }
                    .no-assignee {
                        color: var(--vscode-descriptionForeground);
                        font-style: italic;
                    }
                    .relationships {
                        margin-top: 15px;
                        padding: 15px;
                        background: var(--vscode-sideBar-background);
                        border-radius: 4px;
                    }
                    .relationships-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 10px;
                    }
                    .relationships-title {
                        font-weight: bold;
                        font-size: 0.9em;
                        color: var(--vscode-descriptionForeground);
                    }
                    .relationships-actions {
                        display: flex;
                        gap: 8px;
                    }
                    .relationships-actions button {
                        padding: 2px 8px;
                        font-size: 0.8em;
                        background: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                        border: none;
                        border-radius: 3px;
                        cursor: pointer;
                    }
                    .relationships-actions button:hover {
                        background: var(--vscode-button-secondaryHoverBackground);
                    }
                    .relationship-item {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        padding: 4px 0;
                    }
                    .relation-icon {
                        color: var(--vscode-descriptionForeground);
                        font-size: 0.9em;
                    }
                    .relationship-item a {
                        color: var(--vscode-textLink-foreground);
                        text-decoration: none;
                        font-weight: 500;
                    }
                    .relationship-item a:hover {
                        text-decoration: underline;
                    }
                    .relation-title {
                        color: var(--vscode-foreground);
                        flex: 1;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    }
                    .state-closed {
                        color: var(--vscode-testing-iconPassed, #4caf50);
                    }
                    .progress-section {
                        margin-top: 8px;
                        padding-top: 8px;
                        border-top: 1px solid var(--vscode-panel-border);
                    }
                    .progress-bar {
                        height: 6px;
                        background: var(--vscode-progressBar-background, #0e639c);
                        border-radius: 3px;
                        margin: 4px 0;
                    }
                    .progress-text {
                        font-size: 0.85em;
                        color: var(--vscode-descriptionForeground);
                    }
                    .edit-btn {
                        background: none;
                        border: none;
                        cursor: pointer;
                        padding: 2px 6px;
                        margin-left: 8px;
                        border-radius: 4px;
                        opacity: 0.7;
                    }
                    .edit-btn:hover {
                        opacity: 1;
                        background: var(--vscode-button-secondaryBackground);
                    }
                    .sidebar {
                        margin-top: 15px;
                        padding: 15px;
                        background: var(--vscode-sideBar-background);
                        border-radius: 4px;
                    }
                    .sidebar-title {
                        font-weight: bold;
                        margin-bottom: 10px;
                        font-size: 0.9em;
                        color: var(--vscode-descriptionForeground);
                    }
                    .field-row {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 8px;
                    }
                    .field-label {
                        font-size: 0.9em;
                        color: var(--vscode-descriptionForeground);
                    }
                    .field-select {
                        padding: 4px 8px;
                        background: var(--vscode-dropdown-background);
                        color: var(--vscode-dropdown-foreground);
                        border: 1px solid var(--vscode-dropdown-border);
                        border-radius: 4px;
                        min-width: 150px;
                    }
                    .body {
                        margin: 20px 0;
                        padding: 15px;
                        background: var(--vscode-editor-background);
                        border-radius: 4px;
                    }
                    .body-header {
                        display: flex;
                        align-items: center;
                        margin-bottom: 10px;
                        padding-bottom: 8px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    .body-content {
                        /* Don't use pre-wrap - it preserves template literal indentation */
                    }
                    .body-edit textarea {
                        width: 100%;
                        min-height: 200px;
                        padding: 10px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        font-family: var(--vscode-editor-font-family);
                        font-size: var(--vscode-editor-font-size);
                        resize: vertical;
                        box-sizing: border-box;
                    }
                    .edit-actions {
                        margin-top: 10px;
                        display: flex;
                        gap: 10px;
                        justify-content: flex-end;
                    }
                    .comments-section {
                        margin-top: 30px;
                    }
                    .comments-header {
                        font-size: 1.1em;
                        font-weight: bold;
                        margin-bottom: 15px;
                        padding-bottom: 10px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    .comment {
                        margin-bottom: 15px;
                        padding: 10px 15px;
                        background: var(--vscode-editor-background);
                        border-radius: 4px;
                        border-left: 3px solid var(--vscode-activityBarBadge-background);
                    }
                    .comment-header {
                        display: flex;
                        justify-content: space-between;
                        margin-bottom: 8px;
                    }
                    .comment-body {
                        white-space: pre-wrap;
                    }
                    .date {
                        color: var(--vscode-descriptionForeground);
                        font-size: 0.85em;
                    }
                    .add-comment {
                        margin-top: 20px;
                    }
                    .add-comment textarea {
                        width: 100%;
                        min-height: 100px;
                        padding: 10px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        font-family: inherit;
                        resize: vertical;
                        box-sizing: border-box;
                    }
                    .add-comment-actions {
                        margin-top: 10px;
                        display: flex;
                        justify-content: flex-end;
                    }
                    pre {
                        background: var(--vscode-textBlockQuote-background);
                        padding: 10px;
                        border-radius: 4px;
                        overflow-x: auto;
                    }
                    code {
                        font-family: var(--vscode-editor-font-family);
                    }
                    a {
                        color: var(--vscode-textLink-foreground);
                    }
                    h1, h2, h3, h4, h5, h6 {
                        margin: 16px 0 8px 0;
                        font-weight: 600;
                    }
                    h1 { font-size: 1.5em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 8px; }
                    h2 { font-size: 1.3em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 6px; }
                    h3 { font-size: 1.15em; }
                    h4 { font-size: 1em; }
                    h5 { font-size: 0.9em; }
                    h6 { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
                    ul, ol {
                        margin: 8px 0;
                        padding-left: 24px;
                    }
                    li {
                        margin: 4px 0;
                    }
                    hr {
                        border: none;
                        border-top: 1px solid var(--vscode-panel-border);
                        margin: 16px 0;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="header-top">
                        <div>
                            <h1 class="title">${this._escapeHtml(details.title)}</h1>
                            <div class="meta">
                                #${details.number} opened by ${this._escapeHtml(details.author)} on ${this._formatDate(details.createdAt)}
                            </div>
                        </div>
                        <div class="actions">
                            <button class="btn btn-secondary" onclick="openInBrowser()">Open in GitHub</button>
                            <button class="btn btn-secondary" onclick="refresh()">↻</button>
                        </div>
                    </div>
                    ${issueTypeHtml || labelsHtml ? `<div class="labels">${issueTypeHtml}${labelsHtml}</div>` : ''}
                    <div class="assignees">
                        <strong style="margin-right: 8px;">Assignees:</strong> ${assigneesHtml}
                        <button class="edit-btn" onclick="editAssignees()" title="Edit assignees">✏️</button>
                    </div>
                    ${details.projectFields.length > 0 ? `
                        <div class="sidebar">
                            <div class="sidebar-title">PROJECT FIELDS</div>
                            ${fieldsHtml}
                        </div>
                    ` : ''}
                    ${this._item.type === 'issue' ? `
                        <div class="relationships">
                            <div class="relationships-header">
                                <span class="relationships-title">RELATIONSHIPS</span>
                                <div class="relationships-actions">
                                    ${details.parent ? `<button onclick="removeParent()">Remove Parent</button>` : `<button onclick="setParent()">Set Parent</button>`}
                                    <button onclick="addChild()">Add Child</button>
                                </div>
                            </div>
                            ${parentHtml ? `
                                <div class="parent-section">
                                    <div style="font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-bottom: 4px;">Parent</div>
                                    ${parentHtml}
                                </div>
                            ` : ''}
                            ${subIssuesHtml ? `
                                <div class="children-section" ${parentHtml ? 'style="margin-top: 12px;"' : ''}>
                                    <div style="font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-bottom: 4px;">Sub-issues (${completedCount}/${totalCount})</div>
                                    ${subIssuesHtml}
                                    ${totalCount > 0 ? `
                                        <div class="progress-section">
                                            <div class="progress-bar" style="width: ${progressPct}%;"></div>
                                            <div class="progress-text">${progressPct}% complete</div>
                                        </div>
                                    ` : ''}
                                </div>
                            ` : ''}
                            ${!hasRelationships ? '<div style="color: var(--vscode-descriptionForeground); font-style: italic;">No parent or sub-issues</div>' : ''}
                        </div>
                    ` : ''}
                </div>

                <div class="body">
                    <div class="body-header">
                        <strong>Description</strong>
                        <button class="edit-btn" id="editDescBtn" onclick="startEditDescription()" title="Edit description">✏️</button>
                    </div>
                    <div class="body-content" id="bodyView">
                        ${details.body ? this._renderMarkdown(details.body) : '<em>No description provided.</em>'}
                    </div>
                    <div class="body-edit" id="bodyEdit" style="display: none;">
                        <textarea id="descriptionInput">${this._escapeHtml(details.body || '')}</textarea>
                        <div class="edit-actions">
                            <button class="btn btn-secondary" onclick="cancelEditDescription()">Cancel</button>
                            <button class="btn" onclick="saveDescription()">Save</button>
                        </div>
                    </div>
                </div>

                <div class="comments-section">
                    <div class="comments-header">Comments (${details.comments.length})</div>
                    ${commentsHtml || '<p>No comments yet.</p>'}

                    <div class="add-comment">
                        <textarea id="commentInput" placeholder="Add a comment..."></textarea>
                        <div class="add-comment-actions">
                            <button class="btn" onclick="addComment()">Add Comment</button>
                        </div>
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();

                    function changeField(select) {
                        const fieldId = select.dataset.fieldId;
                        const fieldName = select.dataset.fieldName;
                        const optionId = select.value;
                        const optionName = select.options[select.selectedIndex].dataset.name || '';

                        if (optionId) {
                            vscode.postMessage({
                                type: 'changeField',
                                fieldId,
                                fieldName,
                                optionId,
                                optionName
                            });
                        }
                    }

                    function openInBrowser() {
                        vscode.postMessage({ type: 'openInBrowser' });
                    }

                    function refresh() {
                        vscode.postMessage({ type: 'refresh' });
                    }

                    function addComment() {
                        const input = document.getElementById('commentInput');
                        const body = input.value.trim();
                        if (body) {
                            vscode.postMessage({ type: 'addComment', body });
                            input.value = '';
                        }
                    }

                    function editAssignees() {
                        vscode.postMessage({ type: 'editAssignees' });
                    }

                    function startEditDescription() {
                        document.getElementById('bodyView').style.display = 'none';
                        document.getElementById('bodyEdit').style.display = 'block';
                        document.getElementById('editDescBtn').style.display = 'none';
                        document.getElementById('descriptionInput').focus();
                    }

                    function cancelEditDescription() {
                        document.getElementById('bodyView').style.display = 'block';
                        document.getElementById('bodyEdit').style.display = 'none';
                        document.getElementById('editDescBtn').style.display = '';
                    }

                    function saveDescription() {
                        const newBody = document.getElementById('descriptionInput').value;
                        vscode.postMessage({ type: 'saveDescription', newBody });
                    }

                    function setParent() {
                        vscode.postMessage({ type: 'setParent' });
                    }

                    function removeParent() {
                        vscode.postMessage({ type: 'removeParent' });
                    }

                    function addChild() {
                        vscode.postMessage({ type: 'addChild' });
                    }

                    function openIssue(number) {
                        vscode.postMessage({ type: 'openIssue', number });
                    }
                </script>
            </body>
            </html>
        `;
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    private _renderMarkdown(text: string): string {
        // Escape HTML
        let html = this._escapeHtml(text);

        // Code blocks
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Headings (must come before bold/italic and before line break conversion)
        html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
        html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
        html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

        // Horizontal rule
        html = html.replace(/^---$/gm, '<hr>');

        // Bold
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // Italic
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

        // Unordered lists
        html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

        // Line breaks (but not after block elements)
        html = html.replace(/\n/g, '<br>');

        return html;
    }

    private _formatDate(dateStr: string): string {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    public dispose(): void {
        IssueDetailPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}

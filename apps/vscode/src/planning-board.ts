import * as vscode from 'vscode';
import { GitHubAPI } from './github-api';
import type { NormalizedProjectItem, ProjectWithViews, ProjectV2View } from './types';
import type { RepoInfo } from './repo-detector';
import { getWorktreeForIssue, listWorktrees } from './worktree';
import { removeWorktree } from './git-utils';

interface BoardColumn {
    name: string;
    items: NormalizedProjectItem[];
}

interface ViewData {
    view: ProjectV2View;
    project: ProjectWithViews;
    columns: BoardColumn[];
    allItems: NormalizedProjectItem[]; // Unfiltered items for slicing
    layout: 'board' | 'list'; // How to render this view
}

interface SliceOption {
    field: string;
    label: string;
    values: string[];
}

interface SliceFilters {
    [field: string]: string | null; // null means "all"
}

export class PlanningBoardPanel {
    public static currentPanel: PlanningBoardPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _api: GitHubAPI;
    private _repo: RepoInfo;
    private _projects: ProjectWithViews[] = [];
    private _viewsData: ViewData[] = [];
    private _activeTabIndex = 0;
    private _disposables: vscode.Disposable[] = [];
    private _sliceOptions: SliceOption[] = [];
    private _sliceFilters: SliceFilters = {};

    private constructor(
        panel: vscode.WebviewPanel,
        api: GitHubAPI,
        repo: RepoInfo,
        projects: ProjectWithViews[]
    ) {
        this._panel = panel;
        this._api = api;
        this._repo = repo;
        this._projects = projects;

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
        repo: RepoInfo,
        projects: ProjectWithViews[]
    ): Promise<void> {
        const column = vscode.ViewColumn.One;

        if (PlanningBoardPanel.currentPanel) {
            PlanningBoardPanel.currentPanel._repo = repo;
            PlanningBoardPanel.currentPanel._projects = projects;
            PlanningBoardPanel.currentPanel._panel.reveal(column);
            await PlanningBoardPanel.currentPanel._loadAndRender();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'planningBoard',
            'Planning Board',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        PlanningBoardPanel.currentPanel = new PlanningBoardPanel(panel, api, repo, projects);
    }

    /**
     * Trigger the new issue form from external command
     */
    public async triggerNewIssue(): Promise<void> {
        await this._showNewIssueForm();
    }

    private async _loadAndRender(): Promise<void> {
        this._panel.webview.html = this._getLoadingHtml();

        try {
            await this._loadViewsData();
            this._panel.webview.html = this._getHtml();
        } catch (error) {
            this._panel.webview.html = this._getErrorHtml(
                error instanceof Error ? error.message : 'Failed to load board'
            );
        }
    }

    private async _loadViewsData(): Promise<void> {
        const config = vscode.workspace.getConfiguration('ghProjects');
        const planningViews = config.get<string[]>('planningModeViews', []);
        const assignedToMe = config.get<boolean>('showOnlyAssignedToMe', false);

        this._viewsData = [];
        this._sliceOptions = [];

        for (const project of this._projects) {
            // Get all items for this project
            const allItems = await this._api.getProjectItems(project.id, {
                assignedToMe,
                statusFieldName: 'Status',
            });

            // Get status options for ordering
            const statusOptions = await this._api.getProjectStatusOptions(project.id);

            // Get project fields for slice options
            const projectFields = await this._api.getProjectFields(project.id);

            // Build slice options from fields (excluding Status which is used for columns)
            this._buildSliceOptions(allItems, projectFields);

            // Filter views based on settings - allow ANY layout type now (Board, Table, Roadmap)
            let viewsToShow = project.views;

            if (planningViews.length > 0) {
                viewsToShow = viewsToShow.filter((v) =>
                    planningViews.some((pv) => pv.toLowerCase() === v.name.toLowerCase())
                );
            } else {
                // Default: show only board views if no specific views configured
                viewsToShow = viewsToShow.filter((v) => v.layout === 'BOARD_LAYOUT');
            }

            for (const view of viewsToShow) {
                // Apply view filter first
                const viewFilteredItems = this._applyViewFilter(allItems, view.filter);

                // Apply slice filters
                const slicedItems = this._applySliceFilters(viewFilteredItems);

                // Group by status
                const columns = this._groupByStatus(slicedItems, statusOptions);

                // Determine how to render: board views get kanban, others get list
                const layout = view.layout === 'BOARD_LAYOUT' ? 'board' : 'list';

                this._viewsData.push({
                    view,
                    project,
                    columns,
                    allItems: viewFilteredItems, // Store for re-slicing without reload
                    layout,
                });
            }
        }
    }

    private _buildSliceOptions(
        items: NormalizedProjectItem[],
        projectFields: Array<{ id: string; name: string; options: Array<{ id: string; name: string }> }>
    ): void {
        // Add Issue Type as a slice option (org-level issue type, not project field)
        const issueTypes = new Set<string>();
        for (const item of items) {
            if (item.issueType) {
                issueTypes.add(item.issueType);
            }
        }
        if (issueTypes.size > 0) {
            this._sliceOptions.push({
                field: 'issueType',
                label: 'Type',
                values: Array.from(issueTypes).sort(),
            });
        }

        // Add Assignee as a slice option
        const assignees = new Set<string>();
        for (const item of items) {
            for (const assignee of item.assignees) {
                assignees.add(assignee.login);
            }
        }
        if (assignees.size > 0) {
            this._sliceOptions.push({
                field: 'assignee',
                label: 'Assignee',
                values: Array.from(assignees).sort(),
            });
        }

        // Add single-select fields (except Status which is used for columns)
        for (const field of projectFields) {
            if (field.name.toLowerCase() === 'status') continue;
            if (field.options.length > 0) {
                // Collect values actually used in items
                const usedValues = new Set<string>();
                for (const item of items) {
                    const fieldInfo = item.fields.get(field.name.toLowerCase());
                    if (fieldInfo && fieldInfo.value) usedValues.add(fieldInfo.value);
                }

                if (usedValues.size > 0) {
                    this._sliceOptions.push({
                        field: field.name.toLowerCase(),
                        label: field.name,
                        values: Array.from(usedValues).sort(),
                    });
                }
            }
        }
    }

    private _applySliceFilters(items: NormalizedProjectItem[]): NormalizedProjectItem[] {
        return items.filter((item) => {
            for (const [field, value] of Object.entries(this._sliceFilters)) {
                if (value === null) continue; // "All" selected

                if (field === 'assignee') {
                    if (!item.assignees.some((a) => a.login === value)) return false;
                } else if (field === 'issueType') {
                    // Org-level issue type (Bug, Feature, etc.)
                    if (item.issueType !== value) return false;
                } else {
                    // Custom project fields (Priority, Size, etc.)
                    const fieldInfo = item.fields.get(field);
                    if (!fieldInfo || fieldInfo.value !== value) return false;
                }
            }
            return true;
        });
    }

    private async _reapplySliceFilters(): Promise<void> {
        // Re-slice existing data without reloading from API
        for (const viewData of this._viewsData) {
            const slicedItems = this._applySliceFilters(viewData.allItems);
            // Use the cached status order from the original columns
            const statusOrder = viewData.columns.map((c) => c.name);
            // Also need to include statuses that might now have items due to filter changes
            const allStatuses = await this._api.getProjectStatusOptions(viewData.project.id);
            viewData.columns = this._groupByStatus(slicedItems, allStatuses);
        }
    }

    private _applyViewFilter(
        items: NormalizedProjectItem[],
        filter: string | null | undefined
    ): NormalizedProjectItem[] {
        if (!filter || filter.trim() === '') {
            return items;
        }

        const currentUser = this._api.username;
        const parts = filter.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
        const conditions: Array<{ field: string; values: string[]; negate: boolean }> = [];

        for (const part of parts) {
            const negate = part.startsWith('-');
            const cleanPart = negate ? part.slice(1) : part;
            const colonIndex = cleanPart.indexOf(':');
            if (colonIndex === -1) continue;

            const field = cleanPart.slice(0, colonIndex).toLowerCase();
            const valueStr = cleanPart.slice(colonIndex + 1).replace(/"/g, '');
            const values = valueStr.split(',').map((v) => v.trim().toLowerCase());

            conditions.push({ field, values, negate });
        }

        return items.filter((item) => {
            for (const condition of conditions) {
                let matches = false;

                switch (condition.field) {
                    case 'assignee':
                        if (condition.values.includes('@me')) {
                            matches = currentUser ? item.assignees.some((a) => a.login === currentUser) : false;
                        } else {
                            matches = condition.values.some((v) =>
                                item.assignees.some((a) => a.login.toLowerCase() === v)
                            );
                        }
                        break;
                    case 'status':
                        matches = condition.values.some((v) => item.status?.toLowerCase() === v);
                        break;
                    case 'type':
                        // Issue type (Bug, Feature, Epic, etc.)
                        matches = condition.values.some((v) => item.issueType?.toLowerCase() === v);
                        break;
                    case 'label':
                        // Issue labels
                        matches = condition.values.some((v) =>
                            item.labels?.some((l) => l.name.toLowerCase() === v)
                        );
                        break;
                    case 'is':
                    case 'state':
                        // Issue state (open, closed, merged) - support both 'is:' and 'state:' syntax
                        matches = condition.values.some((v) => item.state === v);
                        break;
                    default:
                        const fieldInfo = item.fields.get(condition.field);
                        matches = condition.values.some((v) => fieldInfo?.value?.toLowerCase() === v);
                }

                if (condition.negate) matches = !matches;
                if (!matches) return false;
            }
            return true;
        });
    }

    private _groupByStatus(
        items: NormalizedProjectItem[],
        statusOrder: string[]
    ): BoardColumn[] {
        const itemsByStatus = new Map<string, NormalizedProjectItem[]>();

        for (const item of items) {
            const status = item.status || 'No Status';
            if (!itemsByStatus.has(status)) {
                itemsByStatus.set(status, []);
            }
            itemsByStatus.get(status)!.push(item);
        }

        const columns: BoardColumn[] = [];

        // Add columns in order - but ONLY if they have items
        // This naturally honors view filters (e.g., if view excludes "Done", those items won't be here)
        for (const status of statusOrder) {
            const columnItems = itemsByStatus.get(status);
            if (columnItems && columnItems.length > 0) {
                columns.push({
                    name: status,
                    items: columnItems,
                });
            }
            itemsByStatus.delete(status);
        }

        // Add any remaining statuses with items
        for (const [name, columnItems] of itemsByStatus) {
            if (columnItems.length > 0) {
                columns.push({ name, items: columnItems });
            }
        }

        return columns;
    }

    private async _handleMessage(message: { type: string; [key: string]: unknown }): Promise<void> {
        switch (message.type) {
            case 'switchTab':
                this._activeTabIndex = message.index as number;
                this._panel.webview.html = this._getHtml();
                break;

            case 'moveItem':
                await this._moveItem(
                    message.itemId as string,
                    message.newStatus as string,
                    message.newIndex as number
                );
                break;

            case 'openItem':
                const foundItem = this._findItemById(message.itemId as string);
                if (foundItem) {
                    // Import IssueDetailPanel and call directly since ItemNode is internal to tree-provider
                    const { IssueDetailPanel } = await import('./issue-detail-panel');
                    await IssueDetailPanel.show(this._api, foundItem.item, foundItem.project);
                }
                break;

            case 'setSlice':
                const field = message.field as string;
                const value = message.value as string | null;
                if (value === '' || value === 'all') {
                    this._sliceFilters[field] = null;
                } else {
                    this._sliceFilters[field] = value;
                }
                await this._reapplySliceFilters();
                this._panel.webview.html = this._getHtml();
                break;

            case 'clearSlices':
                this._sliceFilters = {};
                await this._reapplySliceFilters();
                this._panel.webview.html = this._getHtml();
                break;

            case 'refresh':
                // Re-fetch projects to get updated view filters from GitHub
                try {
                    this._projects = await this._api.getProjectsWithViews(this._repo);
                } catch (err) {
                    console.error('[PlanningBoard] Failed to refresh projects:', err);
                }
                await this._loadAndRender();
                break;

            case 'newIssue':
                await this._showNewIssueForm();
                break;

            case 'createIssue':
                await this._createIssue(
                    message.title as string,
                    message.body as string,
                    message.template as string | null
                );
                break;

            case 'cancelNewIssue':
                this._panel.webview.html = this._getHtml();
                break;
        }
    }

    private async _moveItem(itemId: string, newStatus: string, _newIndex: number): Promise<void> {
        const itemData = this._findItemById(itemId);
        if (!itemData) return;

        try {
            const success = await this._api.updateItemStatusByName(
                itemData.project.id,
                itemId,
                newStatus
            );

            if (success) {
                // Update local state
                itemData.item.status = newStatus;
                await this._loadAndRender();
                vscode.commands.executeCommand('ghProjects.refresh');

                // Check if moved to "done" status
                const isDoneStatus = newStatus.toLowerCase().includes('done') ||
                                     newStatus.toLowerCase().includes('complete');
                if (isDoneStatus && itemData.item.number && itemData.item.repository) {
                    const [owner, repo] = itemData.item.repository.split('/');

                    // Remove active label
                    try {
                        const labelName = this._api.getActiveLabelName();
                        await this._api.removeLabelFromIssue(owner, repo, itemData.item.number, labelName);
                    } catch {
                        // Label might not exist, that's ok
                    }

                    // Check for worktree and offer to remove
                    const worktree = await getWorktreeForIssue(itemData.item.number);
                    if (worktree && !worktree.isMain) {
                        const choice = await vscode.window.showInformationMessage(
                            `Issue #${itemData.item.number} has a worktree at ${worktree.path}. Remove it?`,
                            'Yes', 'No'
                        );
                        if (choice === 'Yes') {
                            try {
                                await removeWorktree(worktree.path);
                                vscode.window.showInformationMessage('Worktree removed');
                            } catch {
                                vscode.window.showWarningMessage(
                                    'Could not remove worktree (may have uncommitted changes)'
                                );
                            }
                        }
                    }
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to move item: ${error}`);
        }
    }

    private _findItemById(itemId: string): { item: NormalizedProjectItem; project: ProjectWithViews } | null {
        for (const viewData of this._viewsData) {
            for (const column of viewData.columns) {
                const item = column.items.find((i) => i.id === itemId);
                if (item) {
                    return { item, project: viewData.project };
                }
            }
        }
        return null;
    }

    private async _showNewIssueForm(): Promise<void> {
        // Read issue templates from workspace
        const { templates, blankIssuesEnabled } = await this._getIssueTemplates();

        // Get default template from settings
        const config = vscode.workspace.getConfiguration('ghProjects');
        const defaultTemplate = config.get<string>('defaultIssueTemplate', '');

        this._panel.webview.html = this._getNewIssueFormHtml(templates, blankIssuesEnabled, defaultTemplate);
    }

    private async _getIssueTemplates(): Promise<{
        templates: Array<{ name: string; filename: string; body: string; labels?: string[] }>;
        blankIssuesEnabled: boolean;
    }> {
        const templates: Array<{ name: string; filename: string; body: string; labels?: string[] }> = [];
        let repoBlankIssuesEnabled = true; // Default to true if no config

        // Find workspace folder
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return { templates, blankIssuesEnabled: this._resolveBlankIssuesSetting(repoBlankIssuesEnabled) };
        }

        const workspaceRoot = workspaceFolders[0].uri;
        const templateDir = vscode.Uri.joinPath(workspaceRoot, '.github', 'ISSUE_TEMPLATE');

        try {
            const files = await vscode.workspace.fs.readDirectory(templateDir);

            for (const [filename, fileType] of files) {
                if (fileType !== vscode.FileType.File) continue;

                // Skip config files - they configure GitHub's behavior, not actual templates
                if (filename === 'config.yml' || filename === 'config.yaml') {
                    // Read config to check blank_issues_enabled
                    const configUri = vscode.Uri.joinPath(templateDir, filename);
                    const configContent = await vscode.workspace.fs.readFile(configUri);
                    const configText = new TextDecoder().decode(configContent);
                    const blankMatch = configText.match(/^blank_issues_enabled:\s*(true|false)/m);
                    if (blankMatch) {
                        repoBlankIssuesEnabled = blankMatch[1] === 'true';
                    }
                    continue;
                }

                if (!filename.endsWith('.md') && !filename.endsWith('.yml') && !filename.endsWith('.yaml')) continue;

                const fileUri = vscode.Uri.joinPath(templateDir, filename);
                const content = await vscode.workspace.fs.readFile(fileUri);
                const text = new TextDecoder().decode(content);

                // Parse YAML frontmatter
                const parsed = this._parseTemplateFile(text, filename);
                if (parsed) {
                    templates.push(parsed);
                }
            }
        } catch {
            // Template directory doesn't exist, that's fine
        }

        return {
            templates,
            blankIssuesEnabled: this._resolveBlankIssuesSetting(repoBlankIssuesEnabled)
        };
    }

    private _resolveBlankIssuesSetting(repoSetting: boolean): boolean {
        const config = vscode.workspace.getConfiguration('ghProjects');
        const setting = config.get<string>('allowBlankIssues', 'auto');

        switch (setting) {
            case 'always':
                return true;
            case 'never':
                return false;
            case 'auto':
            default:
                return repoSetting;
        }
    }

    private _parseTemplateFile(
        content: string,
        filename: string
    ): { name: string; filename: string; body: string; labels?: string[] } | null {
        // Check for YAML frontmatter (between --- lines)
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

        if (frontmatterMatch) {
            const frontmatter = frontmatterMatch[1];
            const body = frontmatterMatch[2].trim();

            // Simple YAML parsing for common fields
            const nameMatch = frontmatter.match(/^name:\s*["']?(.+?)["']?\s*$/m);
            const labelsMatch = frontmatter.match(/^labels:\s*\[(.+?)\]/m);

            const name = nameMatch ? nameMatch[1].trim() : filename.replace(/\.(md|yml|yaml)$/, '');
            const labels = labelsMatch
                ? labelsMatch[1].split(',').map(l => l.trim().replace(/["']/g, ''))
                : undefined;

            return { name, filename, body, labels };
        }

        // No frontmatter, use filename as name
        return {
            name: filename.replace(/\.(md|yml|yaml)$/, ''),
            filename,
            body: content,
        };
    }

    private async _createIssue(title: string, body: string, _templateName: string | null): Promise<void> {
        if (!title.trim()) {
            vscode.window.showErrorMessage('Issue title is required');
            return;
        }

        // Get current project and repo info
        const project = this._projects[0];
        if (!project) {
            vscode.window.showErrorMessage('No project available');
            return;
        }

        // Get repo from first view's items or from project owner
        let owner = '';
        let repo = '';

        // Try to get from existing items
        for (const viewData of this._viewsData) {
            for (const column of viewData.columns) {
                for (const item of column.items) {
                    if (item.repository) {
                        [owner, repo] = item.repository.split('/');
                        break;
                    }
                }
                if (owner) break;
            }
            if (owner) break;
        }

        // Fallback to project owner
        if (!owner && project.owner) {
            owner = project.owner.login;
            // Try to detect repo from workspace
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const folderName = workspaceFolders[0].name;
                repo = folderName;
            }
        }

        if (!owner || !repo) {
            vscode.window.showErrorMessage('Could not determine repository');
            return;
        }

        try {
            // Create the issue
            const issue = await this._api.createIssue(owner, repo, title, body);

            if (issue) {
                // Add to project
                await this._api.addIssueToProject(project.id, issue.id);

                vscode.window.showInformationMessage(`Issue #${issue.number} created and added to project`);

                // Reload the board
                await this._loadAndRender();
                vscode.commands.executeCommand('ghProjects.refresh');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create issue: ${error}`);
        }
    }

    private _getNewIssueFormHtml(
        templates: Array<{ name: string; filename: string; body: string; labels?: string[] }>,
        blankIssuesEnabled: boolean,
        defaultTemplate: string = ''
    ): string {
        // Helper to check if a template matches the default setting
        // Matches with or without file extension (e.g., "bug_report" matches "bug_report.md")
        const isDefaultTemplate = (filename: string): boolean => {
            if (!defaultTemplate) return false;
            const normalizedDefault = defaultTemplate.toLowerCase();
            const normalizedFilename = filename.toLowerCase();
            return normalizedFilename === normalizedDefault ||
                   normalizedFilename === `${normalizedDefault}.md` ||
                   normalizedFilename === `${normalizedDefault}.yml` ||
                   normalizedFilename === `${normalizedDefault}.yaml`;
        };

        // Build template options - templates first, then blank at the end if allowed
        const templateOptions = templates
            .map(t => {
                const selected = isDefaultTemplate(t.filename) ? ' selected' : '';
                return `<option value="${this._escapeHtml(t.filename)}"${selected}>${this._escapeHtml(t.name)}</option>`;
            })
            .join('');

        const blankOption = blankIssuesEnabled ? '<option value="">Blank Issue</option>' : '';

        const templateBodies = JSON.stringify(
            templates.reduce((acc, t) => ({ ...acc, [t.filename]: t.body }), {} as Record<string, string>)
        );

        // If no templates and blank not allowed, show error
        const noTemplatesError = templates.length === 0 && !blankIssuesEnabled;

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        padding: 20px;
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                        max-width: 800px;
                        margin: 0 auto;
                    }
                    h1 {
                        font-size: 1.5em;
                        margin-bottom: 20px;
                    }
                    .form-group {
                        margin-bottom: 16px;
                    }
                    label {
                        display: block;
                        margin-bottom: 6px;
                        font-weight: 500;
                    }
                    input, select, textarea {
                        width: 100%;
                        padding: 8px 12px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        font-family: inherit;
                        font-size: inherit;
                        box-sizing: border-box;
                    }
                    textarea {
                        min-height: 300px;
                        resize: vertical;
                    }
                    .button-row {
                        display: flex;
                        gap: 10px;
                        margin-top: 20px;
                    }
                    .btn {
                        padding: 8px 16px;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: inherit;
                    }
                    .btn-primary {
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                    }
                    .btn-primary:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    .btn-secondary {
                        background: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                    }
                </style>
            </head>
            <body>
                <h1>Create New Issue</h1>

                ${noTemplatesError ? `
                    <div class="error-message" style="background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); padding: 12px; border-radius: 4px; margin-bottom: 16px;">
                        <strong>Cannot create issues</strong><br>
                        This repository has disabled blank issues and has no issue templates configured.
                    </div>
                ` : `
                    ${templates.length > 0 || blankIssuesEnabled ? `
                        <div class="form-group">
                            <label for="template">Template</label>
                            <select id="template" onchange="applyTemplate()">
                                ${templateOptions}
                                ${blankOption}
                            </select>
                        </div>
                    ` : ''}

                    <div class="form-group">
                        <label for="title">Title *</label>
                        <input type="text" id="title" placeholder="Issue title" autofocus />
                    </div>

                    <div class="form-group">
                        <label for="body">Description</label>
                        <textarea id="body" placeholder="Describe the issue..."></textarea>
                    </div>

                    <div class="button-row">
                        <button class="btn btn-primary" onclick="createIssue()">Create Issue</button>
                        <button class="btn btn-secondary" onclick="cancel()">Cancel</button>
                    </div>
                `}

                <script>
                    const vscode = acquireVsCodeApi();
                    const templateBodies = ${templateBodies};

                    function applyTemplate() {
                        const select = document.getElementById('template');
                        const body = document.getElementById('body');
                        if (!select || !body) return;

                        const templateName = select.value;
                        if (templateName && templateBodies[templateName]) {
                            body.value = templateBodies[templateName];
                        } else {
                            body.value = '';
                        }
                    }

                    function createIssue() {
                        const title = document.getElementById('title').value;
                        const body = document.getElementById('body').value;
                        const template = document.getElementById('template')?.value || null;

                        vscode.postMessage({
                            type: 'createIssue',
                            title,
                            body,
                            template
                        });
                    }

                    function cancel() {
                        vscode.postMessage({ type: 'cancelNewIssue' });
                    }

                    // Apply first template on load if one is selected
                    document.addEventListener('DOMContentLoaded', function() {
                        applyTemplate();
                    });
                </script>
            </body>
            </html>
        `;
    }

    private _getLoadingHtml(): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        padding: 40px;
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        margin: 0;
                    }
                </style>
            </head>
            <body>
                <div>Loading board...</div>
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
                        padding: 40px;
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                    }
                    .error {
                        color: var(--vscode-errorForeground);
                        padding: 20px;
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

    private _getHtml(): string {
        if (this._viewsData.length === 0) {
            return this._getErrorHtml('No views found. Configure views in settings or add views to your project.');
        }

        const activeView = this._viewsData[this._activeTabIndex] || this._viewsData[0];

        // Layout icons for tabs
        const layoutIcons: Record<string, string> = {
            'BOARD_LAYOUT': '▦',
            'TABLE_LAYOUT': '☰',
            'ROADMAP_LAYOUT': '📅',
        };

        // Generate tabs with layout indicator
        const tabsHtml = this._viewsData
            .map((v, i) => {
                const icon = layoutIcons[v.view.layout] || '▦';
                const itemCount = v.columns.reduce((sum, c) => sum + c.items.length, 0);
                return `
                    <button class="tab ${i === this._activeTabIndex ? 'active' : ''}" onclick="switchTab(${i})">
                        <span class="tab-icon">${icon}</span>
                        ${this._escapeHtml(v.view.name)}
                        <span class="tab-count">${itemCount}</span>
                    </button>
                `;
            })
            .join('');

        // Generate content based on layout
        const contentHtml = activeView.layout === 'board'
            ? this._renderBoardView(activeView)
            : this._renderListView(activeView);

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    * { box-sizing: border-box; }
                    body {
                        padding: 0;
                        margin: 0;
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                        background: var(--vscode-editor-background);
                        height: 100vh;
                        display: flex;
                        flex-direction: column;
                    }
                    .header {
                        padding: 10px 20px;
                        background: var(--vscode-sideBar-background);
                        border-bottom: 1px solid var(--vscode-panel-border);
                        display: flex;
                        align-items: center;
                        gap: 10px;
                    }
                    .tabs {
                        display: flex;
                        gap: 4px;
                        flex: 1;
                    }
                    .tab {
                        padding: 8px 16px;
                        background: transparent;
                        color: var(--vscode-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    }
                    .tab:hover {
                        background: var(--vscode-list-hoverBackground);
                    }
                    .tab.active {
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                    }
                    .tab-count {
                        background: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                        padding: 2px 6px;
                        border-radius: 10px;
                        font-size: 0.8em;
                    }
                    .header-actions {
                        display: flex;
                        gap: 8px;
                        align-items: center;
                    }
                    .new-issue-btn {
                        padding: 6px 12px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: 500;
                    }
                    .new-issue-btn:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    .refresh-btn {
                        padding: 6px 12px;
                        background: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                    }
                    .board {
                        flex: 1;
                        display: flex;
                        gap: 16px;
                        padding: 20px;
                        overflow-x: auto;
                    }
                    .column {
                        min-width: 300px;
                        max-width: 350px;
                        background: var(--vscode-sideBar-background);
                        border-radius: 8px;
                        display: flex;
                        flex-direction: column;
                    }
                    .column-header {
                        padding: 12px 16px;
                        font-weight: bold;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    .column-count {
                        background: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                        padding: 2px 8px;
                        border-radius: 10px;
                        font-size: 0.85em;
                        font-weight: normal;
                    }
                    .column-items {
                        flex: 1;
                        padding: 8px;
                        overflow-y: auto;
                        min-height: 100px;
                    }
                    .card {
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 6px;
                        padding: 12px;
                        margin-bottom: 8px;
                        cursor: grab;
                        transition: transform 0.1s, box-shadow 0.1s;
                    }
                    .card:hover {
                        border-color: var(--vscode-focusBorder);
                    }
                    .card.dragging {
                        opacity: 0.5;
                        transform: rotate(2deg);
                    }
                    .card-active {
                        border-left: 3px solid var(--vscode-charts-green, #2da44e);
                    }
                    .card-title {
                        font-weight: 500;
                        margin-bottom: 8px;
                        cursor: pointer;
                    }
                    .card-title:hover {
                        color: var(--vscode-textLink-foreground);
                    }
                    .card-meta {
                        font-size: 0.85em;
                        color: var(--vscode-descriptionForeground);
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    }
                    .card-assignees {
                        display: flex;
                        gap: 4px;
                    }
                    .card-assignee {
                        background: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                        padding: 2px 6px;
                        border-radius: 10px;
                        font-size: 0.8em;
                        text-transform: uppercase;
                    }
                    .card-assignee-avatar {
                        width: 24px;
                        height: 24px;
                        border-radius: 50%;
                        border: 1px solid var(--vscode-panel-border);
                    }
                    .card-type {
                        display: flex;
                        align-items: center;
                        gap: 4px;
                    }
                    .empty-column {
                        text-align: center;
                        color: var(--vscode-descriptionForeground);
                        padding: 20px;
                        font-style: italic;
                    }
                    .drop-zone {
                        border: 2px dashed var(--vscode-focusBorder);
                        border-radius: 6px;
                        min-height: 60px;
                        margin: 4px 0;
                        background: var(--vscode-list-hoverBackground);
                    }
                    .slice-bar {
                        padding: 8px 20px;
                        background: var(--vscode-sideBar-background);
                        border-bottom: 1px solid var(--vscode-panel-border);
                        display: flex;
                        align-items: center;
                        gap: 12px;
                        flex-wrap: wrap;
                    }
                    .slice-label {
                        font-size: 0.85em;
                        color: var(--vscode-descriptionForeground);
                        font-weight: 500;
                    }
                    .slice-group {
                        display: flex;
                        align-items: center;
                        gap: 6px;
                    }
                    .slice-select {
                        padding: 4px 8px;
                        background: var(--vscode-dropdown-background);
                        color: var(--vscode-dropdown-foreground);
                        border: 1px solid var(--vscode-dropdown-border);
                        border-radius: 4px;
                        font-size: 0.85em;
                        cursor: pointer;
                    }
                    .slice-select:focus {
                        outline: 1px solid var(--vscode-focusBorder);
                    }
                    .slice-select.active {
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border-color: var(--vscode-button-background);
                    }
                    .clear-slices {
                        padding: 4px 8px;
                        background: transparent;
                        color: var(--vscode-textLink-foreground);
                        border: none;
                        border-radius: 4px;
                        font-size: 0.85em;
                        cursor: pointer;
                        margin-left: auto;
                    }
                    .clear-slices:hover {
                        background: var(--vscode-list-hoverBackground);
                    }
                    .active-filters {
                        display: flex;
                        gap: 6px;
                        align-items: center;
                    }
                    .filter-chip {
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        padding: 2px 8px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border-radius: 12px;
                        font-size: 0.8em;
                    }
                    .filter-chip-remove {
                        cursor: pointer;
                        opacity: 0.8;
                    }
                    .filter-chip-remove:hover {
                        opacity: 1;
                    }
                    .tab-icon {
                        font-size: 0.9em;
                    }
                    /* List view styles */
                    .list-view {
                        flex: 1;
                        padding: 20px;
                        overflow-y: auto;
                    }
                    .list-section {
                        margin-bottom: 24px;
                    }
                    .list-section-header {
                        font-weight: bold;
                        padding: 8px 0;
                        border-bottom: 1px solid var(--vscode-panel-border);
                        margin-bottom: 8px;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    }
                    .list-item {
                        display: flex;
                        align-items: center;
                        padding: 10px 12px;
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 6px;
                        margin-bottom: 6px;
                        gap: 12px;
                    }
                    .list-item:hover {
                        border-color: var(--vscode-focusBorder);
                    }
                    .list-item-active {
                        border-left: 3px solid var(--vscode-charts-green, #2da44e);
                    }
                    .list-item-title {
                        flex: 1;
                        cursor: pointer;
                    }
                    .list-item-title:hover {
                        color: var(--vscode-textLink-foreground);
                    }
                    .list-item-meta {
                        display: flex;
                        gap: 8px;
                        align-items: center;
                        font-size: 0.85em;
                        color: var(--vscode-descriptionForeground);
                    }
                    /* Card field badges */
                    .card-fields {
                        display: flex;
                        flex-wrap: wrap;
                        gap: 4px;
                        margin-top: 6px;
                    }
                    .card-field {
                        display: inline-flex;
                        align-items: center;
                        gap: 3px;
                        padding: 1px 6px;
                        border-radius: 3px;
                        font-size: 0.75em;
                        background: var(--vscode-textBlockQuote-background);
                        color: var(--vscode-descriptionForeground);
                    }
                    .card-issue-type {
                        display: inline-flex;
                        align-items: center;
                        padding: 1px 6px;
                        border-radius: 3px;
                        font-size: 0.75em;
                        font-weight: 500;
                        background: var(--vscode-statusBarItem-prominentBackground, #5a21b5);
                        color: #ffffff;
                    }
                    .card-field-label {
                        opacity: 0.7;
                    }
                    .status-badge {
                        background: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                        font-weight: 500;
                    }
                    .card-label {
                        display: inline-block;
                        padding: 1px 6px;
                        border-radius: 12px;
                        font-size: 0.75em;
                        background: var(--vscode-textLink-foreground);
                        color: var(--vscode-editor-background);
                        font-weight: 500;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="tabs">
                        ${tabsHtml}
                    </div>
                    <div class="header-actions">
                        <button class="new-issue-btn" onclick="newIssue()">+ New Issue</button>
                        <button class="refresh-btn" onclick="refresh()">↻ Refresh</button>
                    </div>
                </div>
                ${this._renderSliceBar()}
                ${contentHtml}

                <script>
                    const vscode = acquireVsCodeApi();
                    let draggedItem = null;

                    function switchTab(index) {
                        vscode.postMessage({ type: 'switchTab', index });
                    }

                    function refresh() {
                        vscode.postMessage({ type: 'refresh' });
                    }

                    function newIssue() {
                        vscode.postMessage({ type: 'newIssue' });
                    }

                    function openItem(itemId) {
                        vscode.postMessage({ type: 'openItem', itemId });
                    }

                    // Drag and Drop
                    function dragStart(event, itemId) {
                        draggedItem = itemId;
                        event.target.classList.add('dragging');
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', itemId);
                    }

                    function dragEnd(event) {
                        event.target.classList.remove('dragging');
                        draggedItem = null;
                        // Remove all drop zones
                        document.querySelectorAll('.drop-zone').forEach(el => el.remove());
                    }

                    function allowDrop(event) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                    }

                    function drop(event) {
                        event.preventDefault();
                        const itemId = event.dataTransfer.getData('text/plain');
                        const column = event.target.closest('.column');
                        if (column && itemId) {
                            const newStatus = column.dataset.status;
                            const columnItems = column.querySelector('.column-items');
                            const cards = columnItems.querySelectorAll('.card');
                            let newIndex = cards.length;

                            // Find drop position
                            for (let i = 0; i < cards.length; i++) {
                                const rect = cards[i].getBoundingClientRect();
                                if (event.clientY < rect.top + rect.height / 2) {
                                    newIndex = i;
                                    break;
                                }
                            }

                            vscode.postMessage({
                                type: 'moveItem',
                                itemId,
                                newStatus,
                                newIndex
                            });
                        }
                    }

                    // Slice/Filter functions
                    function setSlice(field, value) {
                        vscode.postMessage({ type: 'setSlice', field, value });
                    }

                    function clearSlices() {
                        vscode.postMessage({ type: 'clearSlices' });
                    }

                    function removeSlice(field) {
                        vscode.postMessage({ type: 'setSlice', field, value: null });
                    }
                </script>
            </body>
            </html>
        `;
    }

    private _renderSliceBar(): string {
        if (this._sliceOptions.length === 0) {
            return ''; // No slice options available
        }

        // Check if any slices are active
        const activeSlices = Object.entries(this._sliceFilters).filter(
            ([_, value]) => value !== null
        );
        const hasActiveSlices = activeSlices.length > 0;

        // Generate active filter chips
        const activeChipsHtml = activeSlices
            .map(([field, value]) => {
                const option = this._sliceOptions.find((o) => o.field === field);
                const label = option?.label || field;
                return `
                    <span class="filter-chip">
                        ${this._escapeHtml(label)}: ${this._escapeHtml(value!)}
                        <span class="filter-chip-remove" onclick="removeSlice('${field}')">×</span>
                    </span>
                `;
            })
            .join('');

        // Generate slice dropdowns
        const sliceDropdownsHtml = this._sliceOptions
            .map((option) => {
                const currentValue = this._sliceFilters[option.field] || '';
                const isActive = currentValue !== '';

                const optionsHtml = option.values
                    .map(
                        (v) =>
                            `<option value="${this._escapeHtml(v)}" ${v === currentValue ? 'selected' : ''}>${this._escapeHtml(v)}</option>`
                    )
                    .join('');

                return `
                    <div class="slice-group">
                        <select class="slice-select ${isActive ? 'active' : ''}" onchange="setSlice('${option.field}', this.value)">
                            <option value="">All ${this._escapeHtml(option.label)}s</option>
                            ${optionsHtml}
                        </select>
                    </div>
                `;
            })
            .join('');

        return `
            <div class="slice-bar">
                <span class="slice-label">Slice by:</span>
                ${sliceDropdownsHtml}
                ${hasActiveSlices ? `
                    <div class="active-filters">
                        ${activeChipsHtml}
                    </div>
                    <button class="clear-slices" onclick="clearSlices()">Clear all</button>
                ` : ''}
            </div>
        `;
    }

    private _renderBoardView(viewData: ViewData): string {
        const columnsHtml = viewData.columns
            .map((column) => {
                const itemsHtml = column.items
                    .map((item) => this._renderCard(item))
                    .join('');

                return `
                    <div class="column" data-status="${this._escapeHtml(column.name)}">
                        <div class="column-header">
                            <span class="column-title">${this._escapeHtml(column.name)}</span>
                            <span class="column-count">${column.items.length}</span>
                        </div>
                        <div class="column-items" ondrop="drop(event)" ondragover="allowDrop(event)">
                            ${itemsHtml || '<div class="empty-column">No items</div>'}
                        </div>
                    </div>
                `;
            })
            .join('');

        return `<div class="board">${columnsHtml}</div>`;
    }

    private _renderListView(viewData: ViewData): string {
        // For list/table views, show as a flat list (like GitHub's table view)
        const allItems = viewData.columns.flatMap((c) => c.items);

        if (allItems.length === 0) {
            return `<div class="list-view"><div class="empty-column">No items</div></div>`;
        }

        const itemsHtml = allItems
            .map((item) => this._renderListItem(item))
            .join('');

        return `<div class="list-view">${itemsHtml}</div>`;
    }

    private _renderListItem(item: NormalizedProjectItem): string {
        const typeIcon = item.type === 'pr' ? '🔀' : item.type === 'draft' ? '📝' : '🔵';
        const assigneesHtml = this._renderAssignees(item.assignees);
        const fieldsHtml = this._renderFieldBadges(item);
        const isActive = this._isActiveItem(item);
        const activeClass = isActive ? ' list-item-active' : '';

        return `
            <div class="list-item${activeClass}">
                <span class="card-type">${typeIcon}</span>
                <span class="list-item-title" onclick="openItem('${item.id}')">${this._escapeHtml(item.title)}</span>
                ${fieldsHtml}
                <div class="list-item-meta">
                    ${item.repository ? `${item.repository}#${item.number}` : `#${item.number}`}
                    <div class="card-assignees">${assigneesHtml}</div>
                </div>
            </div>
        `;
    }

    /**
     * Check if an item has the "active" label indicating it's currently being worked on.
     */
    private _isActiveItem(item: NormalizedProjectItem): boolean {
        if (!this._api?.username) {
            return false;
        }
        const activeLabel = `@${this._api.username}:active`;
        return item.labels.some(l => l.name === activeLabel);
    }

    private _renderCard(item: NormalizedProjectItem): string {
        const typeIcon = item.type === 'pr' ? '🔀' : item.type === 'draft' ? '📝' : '🔵';
        const assigneesHtml = this._renderAssignees(item.assignees);
        const fieldsHtml = this._renderFieldBadges(item);
        const isActive = this._isActiveItem(item);
        const activeClass = isActive ? ' card-active' : '';

        return `
            <div class="card${activeClass}" draggable="true" ondragstart="dragStart(event, '${item.id}')" ondragend="dragEnd(event)" data-item-id="${item.id}">
                <div class="card-title" onclick="openItem('${item.id}')">${this._escapeHtml(item.title)}</div>
                <div class="card-meta">
                    <span class="card-type">
                        ${typeIcon}
                        ${item.repository ? `${item.repository}#${item.number}` : `#${item.number}`}
                    </span>
                    <div class="card-assignees">${assigneesHtml}</div>
                </div>
                ${fieldsHtml}
            </div>
        `;
    }

    private _renderAssignees(assignees: Array<{ login: string; avatarUrl: string | null }>): string {
        if (assignees.length === 0) return '';

        return assignees.slice(0, 3).map((a) => {
            if (a.avatarUrl) {
                return `<img class="card-assignee-avatar" src="${a.avatarUrl}" alt="${this._escapeHtml(a.login)}" title="${this._escapeHtml(a.login)}" />`;
            }
            return `<span class="card-assignee" title="${this._escapeHtml(a.login)}">${this._escapeHtml(a.login.substring(0, 2))}</span>`;
        }).join('');
    }

    private _renderFieldBadges(item: NormalizedProjectItem): string {
        // Show ALL project custom fields that have values
        const fieldsToShow: string[] = [];

        // Show issue type first if available (org-level issue type)
        if (item.issueType) {
            fieldsToShow.push(`<span class="card-issue-type">${this._escapeHtml(item.issueType)}</span>`);
        }

        // Fields that are already displayed elsewhere and shouldn't be shown as badges
        const skipFields = new Set(['status', 'title']);

        for (const [key, fieldInfo] of item.fields) {
            if (!fieldInfo || !fieldInfo.value) continue; // Skip empty values
            if (skipFields.has(key)) continue; // Skip fields shown elsewhere (status in column, title in card)

            // Apply color styling if available (GitHub uses named colors like "BLUE", "GREEN")
            const colorStyle = fieldInfo.color
                ? `style="background-color: ${this._getFieldBackgroundColor(fieldInfo.color)}; color: #ffffff;"`
                : '';

            fieldsToShow.push(`<span class="card-field" ${colorStyle}><span class="card-field-label">${this._escapeHtml(this._capitalizeFirst(key))}:</span> ${this._escapeHtml(fieldInfo.value)}</span>`);
        }

        // Also show labels if present (from issue/PR, not project field)
        if (item.labels && item.labels.length > 0) {
            const labelsHtml = item.labels
                .map((label) => {
                    // Labels use hex colors like #ff0000
                    const labelStyle = label.color
                        ? `style="background-color: ${label.color}; color: ${this._getContrastColor(label.color)};"`
                        : '';
                    return `<span class="card-label" ${labelStyle}>${this._escapeHtml(label.name)}</span>`;
                })
                .join('');
            fieldsToShow.push(labelsHtml);
        }

        if (fieldsToShow.length === 0) return '';

        return `<div class="card-fields">${fieldsToShow.join('')}</div>`;
    }

    /**
     * GitHub Project field colors are named (e.g., "BLUE", "GREEN", "RED")
     * Convert to actual hex colors
     */
    private _getFieldBackgroundColor(color: string): string {
        const colorMap: Record<string, string> = {
            'GRAY': '#6e7681',
            'BLUE': '#388bfd',
            'GREEN': '#2da44e',
            'YELLOW': '#d29922',
            'ORANGE': '#db6d28',
            'RED': '#f85149',
            'PINK': '#db61a2',
            'PURPLE': '#a371f7',
        };
        return colorMap[color.toUpperCase()] || color;
    }

    /**
     * Calculate contrasting text color for label backgrounds
     * Labels use hex colors like #ff0000
     */
    private _getContrastColor(hexColor: string): string {
        const hex = hexColor.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        // Calculate relative luminance
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.5 ? '#000000' : '#ffffff';
    }

    private _capitalizeFirst(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    public dispose(): void {
        PlanningBoardPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}

/**
 * Dashboard Panel - WebviewPanel for branch overview
 *
 * Shows:
 * - Branch name and base branch
 * - Files changed with diff status
 * - Commits since branching
 * - Full diff (optional)
 * - External hook results
 */

import * as vscode from 'vscode';
import {
    gatherDashboardData,
    getEnabledHooks,
    executeAllHooks,
    getGitHubRepo,
    getDefaultBranch,
    type BranchDashboardData,
    type FileChange,
    type Commit,
    type HookExecutionResult,
    type HookItem,
} from '@bretwardjames/ghp-core';
import { getCurrentBranch } from './git-utils';

type TabId = 'files' | 'commits' | 'diff';

interface HookResultGroup {
    category: string;
    results: HookExecutionResult[];
}

export class DashboardPanel {
    public static currentPanel: DashboardPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _data: BranchDashboardData | null = null;
    private _hookResults: HookExecutionResult[] = [];
    private _activeTab: TabId = 'files';
    private _isLoading = true;
    private _error: string | null = null;

    private constructor(panel: vscode.WebviewPanel) {
        this._panel = panel;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            (message) => this._handleMessage(message),
            null,
            this._disposables
        );

        this._loadAndRender();
    }

    public static async show(): Promise<void> {
        const column = vscode.ViewColumn.One;

        if (DashboardPanel.currentPanel) {
            DashboardPanel.currentPanel._panel.reveal(column);
            await DashboardPanel.currentPanel._loadAndRender();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'branchDashboard',
            'Branch Dashboard',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        DashboardPanel.currentPanel = new DashboardPanel(panel);
    }

    /**
     * Refresh the dashboard data
     */
    public async refresh(): Promise<void> {
        await this._loadAndRender();
    }

    private async _loadAndRender(): Promise<void> {
        this._isLoading = true;
        this._error = null;
        this._panel.webview.html = this._getHtml();

        try {
            // Get current branch
            const branch = await getCurrentBranch();
            if (!branch) {
                this._error = 'Not in a git repository';
                this._isLoading = false;
                this._panel.webview.html = this._getHtml();
                return;
            }

            // Get base branch from config
            const config = vscode.workspace.getConfiguration('ghProjects');
            const baseBranch = config.get<string>('mainBranch') || await getDefaultBranch() || 'main';

            // Update panel title
            this._panel.title = `Dashboard: ${branch}`;

            // Get enabled hooks and repo
            const enabledHooks = getEnabledHooks();
            const repo = await getGitHubRepo() || 'unknown/unknown';

            // Gather dashboard data and execute hooks in parallel
            const [data, hookResults] = await Promise.all([
                gatherDashboardData({
                    baseBranch,
                    includeDiff: true,
                    maxDiffLines: 1000,
                }),
                enabledHooks.length > 0
                    ? executeAllHooks(enabledHooks, branch, repo)
                    : Promise.resolve([]),
            ]);

            this._data = data;
            this._hookResults = hookResults;
            this._isLoading = false;
            this._panel.webview.html = this._getHtml();
        } catch (error) {
            this._error = error instanceof Error ? error.message : 'Failed to load dashboard data';
            this._isLoading = false;
            this._panel.webview.html = this._getHtml();
        }
    }

    private async _handleMessage(message: { type: string; [key: string]: unknown }): Promise<void> {
        switch (message.type) {
            case 'switchTab':
                this._activeTab = message.tab as TabId;
                this._panel.webview.html = this._getHtml();
                break;

            case 'refresh':
                await this._loadAndRender();
                break;

            case 'openFile':
                const filePath = message.path as string;
                if (filePath) {
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (workspaceFolders && workspaceFolders.length > 0) {
                        const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
                        // Open diff view for modified files
                        if (this._data?.baseBranch) {
                            const originalUri = fileUri.with({ scheme: 'git', query: `${this._data.baseBranch}:${filePath}` });
                            await vscode.commands.executeCommand('vscode.diff', originalUri, fileUri, `${filePath} (diff)`);
                        } else {
                            await vscode.window.showTextDocument(fileUri);
                        }
                    }
                }
                break;

            case 'openDiff':
                const diffFilePath = message.path as string;
                if (diffFilePath && this._data?.baseBranch) {
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (workspaceFolders && workspaceFolders.length > 0) {
                        const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, diffFilePath);
                        // Use git: scheme to show the diff from base branch
                        const args = [
                            `${this._data.baseBranch}...HEAD`,
                            '--',
                            diffFilePath,
                        ];
                        const terminal = vscode.window.createTerminal('Git Diff');
                        terminal.show();
                        terminal.sendText(`git diff ${args.join(' ')}`);
                    }
                }
                break;
        }
    }

    private _getHtml(): string {
        if (this._isLoading) {
            return this._getLoadingHtml();
        }

        if (this._error) {
            return this._getErrorHtml(this._error);
        }

        if (!this._data) {
            return this._getErrorHtml('No data available');
        }

        return this._getMainHtml();
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
                    .loading {
                        text-align: center;
                    }
                    .spinner {
                        width: 40px;
                        height: 40px;
                        border: 3px solid var(--vscode-panel-border);
                        border-top-color: var(--vscode-button-background);
                        border-radius: 50%;
                        animation: spin 1s linear infinite;
                        margin: 0 auto 16px;
                    }
                    @keyframes spin {
                        to { transform: rotate(360deg); }
                    }
                </style>
            </head>
            <body>
                <div class="loading">
                    <div class="spinner"></div>
                    <div>Loading dashboard...</div>
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
                        padding: 40px;
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                    }
                    .error {
                        color: var(--vscode-errorForeground);
                        padding: 20px;
                        border: 1px solid var(--vscode-errorForeground);
                        border-radius: 4px;
                        background: var(--vscode-inputValidation-errorBackground);
                    }
                    .btn {
                        margin-top: 16px;
                        padding: 8px 16px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                    }
                    .btn:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                </style>
            </head>
            <body>
                <div class="error">
                    <strong>Error:</strong> ${this._escapeHtml(message)}
                </div>
                <button class="btn" onclick="refresh()">Try Again</button>
                <script>
                    const vscode = acquireVsCodeApi();
                    function refresh() {
                        vscode.postMessage({ type: 'refresh' });
                    }
                </script>
            </body>
            </html>
        `;
    }

    private _getMainHtml(): string {
        const data = this._data!;
        const stats = data.stats;

        // Group hook results by category
        const hookGroups = this._groupHooksByCategory(this._hookResults);

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

                    /* Header */
                    .header {
                        padding: 16px 20px;
                        background: var(--vscode-sideBar-background);
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    .header-top {
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-start;
                    }
                    .branch-info h1 {
                        font-size: 1.3em;
                        margin: 0 0 4px 0;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    }
                    .branch-name {
                        color: var(--vscode-textLink-foreground);
                    }
                    .branch-arrow {
                        color: var(--vscode-descriptionForeground);
                        font-size: 0.9em;
                    }
                    .base-branch {
                        color: var(--vscode-descriptionForeground);
                    }
                    .stats-summary {
                        display: flex;
                        gap: 16px;
                        margin-top: 12px;
                    }
                    .stat {
                        display: flex;
                        align-items: center;
                        gap: 6px;
                    }
                    .stat-icon {
                        font-size: 1.1em;
                    }
                    .stat-files { color: var(--vscode-charts-blue, #3794ff); }
                    .stat-added { color: var(--vscode-gitDecoration-addedResourceForeground, #81b88b); }
                    .stat-deleted { color: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39); }
                    .stat-commits { color: var(--vscode-charts-yellow, #cca700); }

                    .refresh-btn {
                        padding: 6px 12px;
                        background: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 6px;
                    }
                    .refresh-btn:hover {
                        background: var(--vscode-button-secondaryHoverBackground);
                    }

                    /* Tabs */
                    .tabs {
                        display: flex;
                        gap: 0;
                        background: var(--vscode-sideBar-background);
                        border-bottom: 1px solid var(--vscode-panel-border);
                        padding: 0 20px;
                    }
                    .tab {
                        padding: 10px 20px;
                        background: transparent;
                        color: var(--vscode-foreground);
                        border: none;
                        border-bottom: 2px solid transparent;
                        cursor: pointer;
                        font-size: inherit;
                        opacity: 0.7;
                        transition: opacity 0.15s;
                    }
                    .tab:hover {
                        opacity: 1;
                    }
                    .tab.active {
                        opacity: 1;
                        border-bottom-color: var(--vscode-focusBorder);
                        color: var(--vscode-textLink-foreground);
                    }
                    .tab-count {
                        background: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                        padding: 2px 6px;
                        border-radius: 10px;
                        font-size: 0.85em;
                        margin-left: 6px;
                    }

                    /* Content area */
                    .content {
                        flex: 1;
                        overflow-y: auto;
                        padding: 20px;
                    }

                    /* Files list */
                    .files-list {
                        display: flex;
                        flex-direction: column;
                        gap: 4px;
                    }
                    .file-item {
                        display: flex;
                        align-items: center;
                        padding: 8px 12px;
                        background: var(--vscode-list-inactiveSelectionBackground);
                        border-radius: 4px;
                        cursor: pointer;
                        gap: 10px;
                    }
                    .file-item:hover {
                        background: var(--vscode-list-hoverBackground);
                    }
                    .file-status {
                        width: 20px;
                        text-align: center;
                        font-weight: bold;
                    }
                    .file-status.added { color: var(--vscode-gitDecoration-addedResourceForeground, #81b88b); }
                    .file-status.modified { color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d); }
                    .file-status.deleted { color: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39); }
                    .file-status.renamed { color: var(--vscode-gitDecoration-renamedResourceForeground, #73c991); }
                    .file-path {
                        flex: 1;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    }
                    .file-stats {
                        font-size: 0.85em;
                        color: var(--vscode-descriptionForeground);
                    }

                    /* Commits list */
                    .commits-list {
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                    }
                    .commit-item {
                        display: flex;
                        padding: 10px 12px;
                        background: var(--vscode-list-inactiveSelectionBackground);
                        border-radius: 4px;
                        gap: 12px;
                    }
                    .commit-hash {
                        font-family: var(--vscode-editor-font-family);
                        color: var(--vscode-charts-yellow, #cca700);
                        font-size: 0.9em;
                    }
                    .commit-subject {
                        flex: 1;
                    }
                    .commit-meta {
                        font-size: 0.85em;
                        color: var(--vscode-descriptionForeground);
                    }

                    /* Diff view */
                    .diff-container {
                        font-family: var(--vscode-editor-font-family);
                        font-size: var(--vscode-editor-font-size, 13px);
                        line-height: 1.5;
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 4px;
                        overflow-x: auto;
                        padding: 12px;
                    }
                    .diff-line {
                        white-space: pre;
                    }
                    .diff-line.added {
                        background: var(--vscode-diffEditor-insertedLineBackground, rgba(155, 185, 85, 0.2));
                        color: var(--vscode-gitDecoration-addedResourceForeground, #81b88b);
                    }
                    .diff-line.deleted {
                        background: var(--vscode-diffEditor-removedLineBackground, rgba(255, 0, 0, 0.2));
                        color: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39);
                    }
                    .diff-line.hunk {
                        color: var(--vscode-charts-blue, #3794ff);
                        font-weight: bold;
                    }
                    .diff-line.meta {
                        color: var(--vscode-descriptionForeground);
                    }

                    /* External changes (hooks) */
                    .external-section {
                        margin-top: 24px;
                        padding-top: 20px;
                        border-top: 1px solid var(--vscode-panel-border);
                    }
                    .section-title {
                        font-size: 1.1em;
                        font-weight: bold;
                        margin-bottom: 16px;
                        color: var(--vscode-charts-purple, #b267e6);
                    }
                    .hook-group {
                        margin-bottom: 20px;
                    }
                    .hook-group-title {
                        font-weight: bold;
                        margin-bottom: 8px;
                        text-transform: capitalize;
                    }
                    .hook-result {
                        margin-bottom: 12px;
                        padding: 12px;
                        background: var(--vscode-list-inactiveSelectionBackground);
                        border-radius: 4px;
                    }
                    .hook-title {
                        font-weight: 500;
                        margin-bottom: 8px;
                    }
                    .hook-items {
                        padding-left: 16px;
                    }
                    .hook-item {
                        margin-bottom: 4px;
                    }
                    .hook-item-title {
                        color: var(--vscode-foreground);
                    }
                    .hook-item-summary {
                        color: var(--vscode-descriptionForeground);
                        font-size: 0.9em;
                    }
                    .hook-error {
                        color: var(--vscode-errorForeground);
                        font-style: italic;
                    }

                    /* Empty state */
                    .empty-state {
                        text-align: center;
                        padding: 40px;
                        color: var(--vscode-descriptionForeground);
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="header-top">
                        <div class="branch-info">
                            <h1>
                                <span class="branch-name">${this._escapeHtml(data.branch)}</span>
                                <span class="branch-arrow">&#8592;</span>
                                <span class="base-branch">${this._escapeHtml(data.baseBranch)}</span>
                            </h1>
                        </div>
                        <button class="refresh-btn" onclick="refresh()">
                            &#8635; Refresh
                        </button>
                    </div>
                    <div class="stats-summary">
                        <div class="stat">
                            <span class="stat-icon stat-files">&#128196;</span>
                            <span>${stats.filesChanged} file${stats.filesChanged !== 1 ? 's' : ''} changed</span>
                        </div>
                        <div class="stat">
                            <span class="stat-icon stat-added">+</span>
                            <span>${stats.insertions} insertion${stats.insertions !== 1 ? 's' : ''}</span>
                        </div>
                        <div class="stat">
                            <span class="stat-icon stat-deleted">-</span>
                            <span>${stats.deletions} deletion${stats.deletions !== 1 ? 's' : ''}</span>
                        </div>
                        <div class="stat">
                            <span class="stat-icon stat-commits">&#128221;</span>
                            <span>${data.commits.length} commit${data.commits.length !== 1 ? 's' : ''}</span>
                        </div>
                    </div>
                </div>

                <div class="tabs">
                    <button class="tab ${this._activeTab === 'files' ? 'active' : ''}" onclick="switchTab('files')">
                        Files Changed
                        <span class="tab-count">${stats.filesChanged}</span>
                    </button>
                    <button class="tab ${this._activeTab === 'commits' ? 'active' : ''}" onclick="switchTab('commits')">
                        Commits
                        <span class="tab-count">${data.commits.length}</span>
                    </button>
                    <button class="tab ${this._activeTab === 'diff' ? 'active' : ''}" onclick="switchTab('diff')">
                        Full Diff
                    </button>
                </div>

                <div class="content">
                    ${this._renderActiveTab()}
                    ${this._renderHookResults(hookGroups)}
                </div>

                <script>
                    const vscode = acquireVsCodeApi();

                    function switchTab(tab) {
                        vscode.postMessage({ type: 'switchTab', tab });
                    }

                    function refresh() {
                        vscode.postMessage({ type: 'refresh' });
                    }

                    function openFile(path) {
                        vscode.postMessage({ type: 'openFile', path });
                    }
                </script>
            </body>
            </html>
        `;
    }

    private _renderActiveTab(): string {
        switch (this._activeTab) {
            case 'files':
                return this._renderFilesTab();
            case 'commits':
                return this._renderCommitsTab();
            case 'diff':
                return this._renderDiffTab();
            default:
                return '';
        }
    }

    private _renderFilesTab(): string {
        const files = this._data?.stats.files || [];

        if (files.length === 0) {
            return '<div class="empty-state">No files changed</div>';
        }

        const filesHtml = files.map(file => this._renderFileItem(file)).join('');
        return `<div class="files-list">${filesHtml}</div>`;
    }

    private _renderFileItem(file: FileChange): string {
        const statusIcon = this._getFileStatusIcon(file.status);
        const statusClass = file.status;

        return `
            <div class="file-item" onclick="openFile('${this._escapeHtml(file.path)}')">
                <span class="file-status ${statusClass}">${statusIcon}</span>
                <span class="file-path">${this._escapeHtml(file.path)}</span>
                ${file.insertions > 0 || file.deletions > 0 ? `
                    <span class="file-stats">
                        ${file.insertions > 0 ? `<span class="stat-added">+${file.insertions}</span>` : ''}
                        ${file.deletions > 0 ? `<span class="stat-deleted">-${file.deletions}</span>` : ''}
                    </span>
                ` : ''}
            </div>
        `;
    }

    private _getFileStatusIcon(status: FileChange['status']): string {
        switch (status) {
            case 'added':
                return 'A';
            case 'deleted':
                return 'D';
            case 'renamed':
                return 'R';
            default:
                return 'M';
        }
    }

    private _renderCommitsTab(): string {
        const commits = this._data?.commits || [];

        if (commits.length === 0) {
            return '<div class="empty-state">No commits since branching</div>';
        }

        const commitsHtml = commits.map(commit => this._renderCommitItem(commit)).join('');
        return `<div class="commits-list">${commitsHtml}</div>`;
    }

    private _renderCommitItem(commit: Commit): string {
        return `
            <div class="commit-item">
                <span class="commit-hash">${this._escapeHtml(commit.shortHash)}</span>
                <span class="commit-subject">${this._escapeHtml(commit.subject)}</span>
                <span class="commit-meta">${this._escapeHtml(commit.author)}</span>
            </div>
        `;
    }

    private _renderDiffTab(): string {
        const diff = this._data?.diff;

        if (!diff) {
            return '<div class="empty-state">No diff available</div>';
        }

        const lines = diff.split('\n');
        const diffHtml = lines.map(line => this._renderDiffLine(line)).join('\n');

        return `<div class="diff-container"><pre>${diffHtml}</pre></div>`;
    }

    private _renderDiffLine(line: string): string {
        let className = 'diff-line';

        if (line.startsWith('+') && !line.startsWith('+++')) {
            className += ' added';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            className += ' deleted';
        } else if (line.startsWith('@@')) {
            className += ' hunk';
        } else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) {
            className += ' meta';
        }

        return `<div class="${className}">${this._escapeHtml(line)}</div>`;
    }

    private _groupHooksByCategory(results: HookExecutionResult[]): HookResultGroup[] {
        if (results.length === 0) {
            return [];
        }

        const byCategory = new Map<string, HookExecutionResult[]>();
        for (const result of results) {
            const category = result.hook.category || 'other';
            if (!byCategory.has(category)) {
                byCategory.set(category, []);
            }
            byCategory.get(category)!.push(result);
        }

        return Array.from(byCategory.entries()).map(([category, results]) => ({
            category,
            results,
        }));
    }

    private _renderHookResults(groups: HookResultGroup[]): string {
        if (groups.length === 0) {
            return '';
        }

        const groupsHtml = groups.map(group => this._renderHookGroup(group)).join('');

        return `
            <div class="external-section">
                <div class="section-title">External Changes</div>
                ${groupsHtml}
            </div>
        `;
    }

    private _renderHookGroup(group: HookResultGroup): string {
        const resultsHtml = group.results.map(result => this._renderHookResult(result)).join('');

        return `
            <div class="hook-group">
                <div class="hook-group-title">${this._escapeHtml(group.category)}</div>
                ${resultsHtml}
            </div>
        `;
    }

    private _renderHookResult(result: HookExecutionResult): string {
        const hookName = result.hook.displayName || result.hook.name;

        if (!result.success) {
            return `
                <div class="hook-result">
                    <div class="hook-title">${this._escapeHtml(hookName)}</div>
                    <div class="hook-error">${this._escapeHtml(result.error || 'Unknown error')}</div>
                </div>
            `;
        }

        const data = result.data!;
        const itemsHtml = data.items.length > 0
            ? data.items.map(item => this._renderHookItem(item)).join('')
            : '<div class="hook-item"><span class="hook-item-summary">(no items)</span></div>';

        return `
            <div class="hook-result">
                <div class="hook-title">${this._escapeHtml(hookName)}: ${this._escapeHtml(data.title)}</div>
                <div class="hook-items">${itemsHtml}</div>
            </div>
        `;
    }

    private _renderHookItem(item: HookItem): string {
        return `
            <div class="hook-item">
                <span class="hook-item-title">${this._escapeHtml(item.title)}</span>
                ${item.summary ? `<span class="hook-item-summary"> - ${this._escapeHtml(item.summary)}</span>` : ''}
            </div>
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

    public dispose(): void {
        DashboardPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}

/**
 * Standup Panel - WebviewPanel for daily activity summary
 *
 * Shows recent issue activity across the project board:
 * - Comments, assignments, label changes
 * - Status changes, issue closures/reopenings
 * - PR links and cross-references
 */

import * as vscode from 'vscode';
import {
    parseSince,
    type IssueActivity,
    type RepoInfo,
} from '@bretwardjames/ghp-core';

/**
 * Minimal API interface for standup data fetching.
 * Accepts both core GitHubAPI and VSCodeGitHubAPI.
 */
interface StandupAPI {
    getRecentActivity(
        repo: RepoInfo,
        since: Date,
        options?: { mine?: boolean },
    ): Promise<IssueActivity[]>;
}

export class StandupPanel {
    public static currentPanel: StandupPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _api: StandupAPI;
    private _repo: RepoInfo;
    private _activities: IssueActivity[] = [];
    private _since: Date = new Date(Date.now() - 24 * 60 * 60 * 1000);
    private _sinceInput = '24h';
    private _mine = false;
    private _isLoading = true;
    private _error: string | null = null;
    private _disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        api: StandupAPI,
        repo: RepoInfo,
    ) {
        this._panel = panel;
        this._api = api;
        this._repo = repo;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            (message) => this._handleMessage(message),
            null,
            this._disposables,
        );

        this._loadAndRender();
    }

    public static async show(api: StandupAPI, repo: RepoInfo): Promise<void> {
        const column = vscode.ViewColumn.One;

        if (StandupPanel.currentPanel) {
            StandupPanel.currentPanel._repo = repo;
            StandupPanel.currentPanel._panel.reveal(column);
            await StandupPanel.currentPanel._loadAndRender();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'standupSummary',
            'Standup Summary',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );

        StandupPanel.currentPanel = new StandupPanel(panel, api, repo);
    }

    public async refresh(): Promise<void> {
        await this._loadAndRender();
    }

    private async _loadAndRender(): Promise<void> {
        this._isLoading = true;
        this._error = null;
        this._panel.webview.html = this._getHtml();

        try {
            this._activities = await this._api.getRecentActivity(
                this._repo,
                this._since,
                { mine: this._mine },
            );
            this._isLoading = false;
            this._panel.webview.html = this._getHtml();
        } catch (error) {
            this._error = error instanceof Error ? error.message : 'Failed to load standup data';
            this._isLoading = false;
            this._panel.webview.html = this._getHtml();
        }
    }

    private async _handleMessage(message: { type: string; [key: string]: unknown }): Promise<void> {
        switch (message.type) {
            case 'refresh':
                await this._loadAndRender();
                break;

            case 'changeSince': {
                const sinceStr = message.value as string;
                try {
                    this._since = parseSince(sinceStr);
                    this._sinceInput = sinceStr;
                    await this._loadAndRender();
                } catch {
                    // Invalid input, ignore
                }
                break;
            }

            case 'toggleMine':
                this._mine = !this._mine;
                await this._loadAndRender();
                break;

            case 'openIssue': {
                const url = message.url as string;
                if (url) {
                    vscode.env.openExternal(vscode.Uri.parse(url));
                }
                break;
            }
        }
    }

    private _getHtml(): string {
        const nonce = getNonce();

        if (this._isLoading) {
            return this._wrapHtml(nonce, '<div class="loading">Loading standup data...</div>');
        }

        if (this._error) {
            return this._wrapHtml(nonce, `<div class="error">${escapeHtml(this._error)}</div>`);
        }

        // Build toolbar (no inline event handlers — wired up in script block)
        const toolbar = `
            <div class="toolbar">
                <div class="toolbar-left">
                    <label>Since:
                        <select id="sinceSelect">
                            <option value="8h" ${this._sinceInput === '8h' ? 'selected' : ''}>8 hours</option>
                            <option value="24h" ${this._sinceInput === '24h' ? 'selected' : ''}>24 hours</option>
                            <option value="2d" ${this._sinceInput === '2d' ? 'selected' : ''}>2 days</option>
                            <option value="1w" ${this._sinceInput === '1w' ? 'selected' : ''}>1 week</option>
                        </select>
                    </label>
                    <label class="checkbox-label">
                        <input type="checkbox" id="mineCheckbox" ${this._mine ? 'checked' : ''} />
                        My issues only
                    </label>
                </div>
                <div class="toolbar-right">
                    <span class="count">${this._activities.length} issue${this._activities.length !== 1 ? 's' : ''} changed</span>
                    <button class="btn" id="refreshBtn">Refresh</button>
                </div>
            </div>`;

        // Build activity list
        let activityHtml = '';
        if (this._activities.length === 0) {
            activityHtml = '<div class="empty">No activity found in this time window.</div>';
        } else {
            for (const activity of this._activities) {
                const statusBadge = activity.status
                    ? `<span class="badge">${escapeHtml(activity.status)}</span>`
                    : '';

                const eventsHtml = activity.changes
                    .map(event => {
                        const icon = getEventIcon(event.type);
                        const timestamp = new Date(event.timestamp).toLocaleString();
                        const detail = event.details ? `: ${escapeHtml(event.details)}` : '';
                        return `<div class="event">
                            <span class="event-icon">${icon}</span>
                            <span class="event-text">${escapeHtml(event.type)} by <strong>${escapeHtml(event.actor)}</strong>${detail}</span>
                            <span class="event-time">${timestamp}</span>
                        </div>`;
                    })
                    .join('');

                activityHtml += `
                    <div class="issue-card">
                        <div class="issue-header" data-url="${escapeHtml(activity.issue.url)}">
                            <span class="issue-number">#${activity.issue.number}</span>
                            <span class="issue-title">${escapeHtml(activity.issue.title)}</span>
                            ${statusBadge}
                        </div>
                        <div class="events">${eventsHtml}</div>
                    </div>`;
            }
        }

        return this._wrapHtml(nonce, toolbar + '<div class="activities">' + activityHtml + '</div>');
    }

    private _wrapHtml(nonce: string, body: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <style nonce="${nonce}">
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 16px;
            margin: 0;
        }
        .loading, .error, .empty {
            padding: 24px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
        }
        .error { color: var(--vscode-errorForeground); }
        .toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
            margin-bottom: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .toolbar-left { display: flex; gap: 16px; align-items: center; }
        .toolbar-right { display: flex; gap: 12px; align-items: center; }
        .count { color: var(--vscode-descriptionForeground); font-size: 12px; }
        select, .btn {
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
        }
        .btn:hover { background: var(--vscode-button-hoverBackground); }
        .checkbox-label {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 13px;
        }
        .issue-card {
            margin-bottom: 12px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            overflow: hidden;
        }
        .issue-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 12px;
            background: var(--vscode-sideBar-background);
            cursor: pointer;
        }
        .issue-header:hover { background: var(--vscode-list-hoverBackground); }
        .issue-number {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
            white-space: nowrap;
        }
        .issue-title { flex: 1; }
        .badge {
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 10px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            white-space: nowrap;
        }
        .events { padding: 8px 12px; }
        .event {
            display: flex;
            align-items: baseline;
            gap: 6px;
            padding: 3px 0;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .event-icon { flex-shrink: 0; }
        .event-text { flex: 1; }
        .event-text strong { color: var(--vscode-foreground); }
        .event-time {
            font-size: 11px;
            white-space: nowrap;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    ${body}
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        // Wire up event listeners (CSP-compatible, no inline handlers)
        const sinceSelect = document.getElementById('sinceSelect');
        if (sinceSelect) {
            sinceSelect.addEventListener('change', function() {
                vscode.postMessage({ type: 'changeSince', value: this.value });
            });
        }

        const mineCheckbox = document.getElementById('mineCheckbox');
        if (mineCheckbox) {
            mineCheckbox.addEventListener('change', function() {
                vscode.postMessage({ type: 'toggleMine' });
            });
        }

        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function() {
                vscode.postMessage({ type: 'refresh' });
            });
        }

        document.querySelectorAll('.issue-header[data-url]').forEach(function(el) {
            el.addEventListener('click', function() {
                vscode.postMessage({ type: 'openIssue', url: el.dataset.url });
            });
        });
    </script>
</body>
</html>`;
    }

    private dispose(): void {
        StandupPanel.currentPanel = undefined;
        this._panel.dispose();
        for (const d of this._disposables) {
            d.dispose();
        }
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getEventIcon(type: string): string {
    switch (type) {
        case 'comment': return '💬';
        case 'labeled': return '🏷️';
        case 'unlabeled': return '🏷️';
        case 'assigned': return '👤';
        case 'unassigned': return '👤';
        case 'closed': return '✅';
        case 'reopened': return '🔄';
        case 'referenced': return '🔗';
        default: return '•';
    }
}

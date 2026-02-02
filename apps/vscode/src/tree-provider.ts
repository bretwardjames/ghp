import * as vscode from 'vscode';
import { GitHubAPI } from './vscode-github-api';
import type { BranchLinker } from './branch-linker';
import type {
    NormalizedProjectItem,
    ProjectWithViews,
    ProjectV2View,
} from './types';

/**
 * Tree element types - "My Stuff" hierarchy:
 * Project → Status → Item
 *
 * (Use Planning Mode for full View → Column hierarchy)
 */
export type TreeElement = ProjectNode | ViewNode | StatusGroupNode | ColumnNode | ItemNode | MessageNode;

export class ProjectNode {
    readonly type = 'project' as const;
    constructor(public readonly project: ProjectWithViews) {}
}

export class ViewNode {
    readonly type = 'view' as const;
    constructor(
        public readonly view: ProjectV2View,
        public readonly project: ProjectWithViews
    ) {}
}

export class StatusGroupNode {
    readonly type = 'statusGroup' as const;
    constructor(
        public readonly status: string,
        public readonly items: NormalizedProjectItem[],
        public readonly project: ProjectWithViews
    ) {}
}

export class ColumnNode {
    readonly type = 'column' as const;
    constructor(
        public readonly name: string,
        public readonly color: string | undefined,
        public readonly items: NormalizedProjectItem[],
        public readonly view: ProjectV2View,
        public readonly project: ProjectWithViews
    ) {}
}

export class ItemNode {
    readonly type = 'item' as const;
    constructor(
        public readonly item: NormalizedProjectItem,
        public readonly project: ProjectWithViews
    ) {}
}

export class MessageNode {
    readonly type = 'message' as const;
    constructor(
        public readonly message: string,
        public readonly action?: { command: string; title: string }
    ) {}
}

/**
 * Parse and apply GitHub Projects view filter
 */
function applyViewFilter(
    items: NormalizedProjectItem[],
    filter: string | null | undefined,
    currentUser: string | null
): NormalizedProjectItem[] {
    if (!filter || filter.trim() === '') {
        return items;
    }

    // Parse filter string into conditions
    // Format: "field:value" or "-field:value" for negation
    // Multiple values: "field:value1,value2"
    const conditions: Array<{
        field: string;
        values: string[];
        negate: boolean;
    }> = [];

    // Split by spaces but keep quoted strings together
    const parts = filter.match(/(?:[^\s"]+|"[^"]*")+/g) || [];

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
                    matches = condition.values.some(
                        (v) => item.status?.toLowerCase() === v
                    );
                    break;

                case 'type':
                    matches = condition.values.includes(item.type);
                    break;

                case 'state':
                    matches = condition.values.includes(item.state || '');
                    break;

                case 'no':
                    // Handle "no:assignee", "no:status", etc.
                    if (condition.values.includes('assignee')) {
                        matches = item.assignees.length === 0;
                    } else if (condition.values.includes('status')) {
                        matches = !item.status;
                    }
                    break;

                default:
                    // Check custom fields
                    const fieldInfo = item.fields.get(condition.field);
                    matches = condition.values.some(
                        (v) => fieldInfo?.value?.toLowerCase() === v
                    );
            }

            // Apply negation
            if (condition.negate) {
                matches = !matches;
            }

            // All conditions must match (AND logic)
            if (!matches) {
                return false;
            }
        }

        return true;
    });
}

/**
 * Main tree provider that shows GitHub Projects with their actual views
 * Mirrors the GitHub UI: Projects → Views → Columns → Items
 */
export class ProjectBoardProvider implements vscode.TreeDataProvider<TreeElement> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private projects: ProjectWithViews[] = [];
    private projectItems: Map<string, NormalizedProjectItem[]> = new Map();
    private loading = false;
    private selectedViewId: string | null = null;
    private branchLinker: BranchLinker | null = null;

    constructor(private api: GitHubAPI) {}

    setBranchLinker(linker: BranchLinker): void {
        this.branchLinker = linker;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    async setProjects(projects: ProjectWithViews[]): Promise<void> {
        this.projects = projects;
        this.projectItems.clear();
        this.refresh();
    }

    setLoading(loading: boolean): void {
        this.loading = loading;
        this.refresh();
    }

    /**
     * Load items for a specific project
     */
    async loadProjectItems(project: ProjectWithViews): Promise<NormalizedProjectItem[]> {
        if (this.projectItems.has(project.id)) {
            return this.projectItems.get(project.id)!;
        }

        const config = vscode.workspace.getConfiguration('ghProjects');
        const assignedToMe = config.get<boolean>('showOnlyAssignedToMe', true);

        // Default to "Status" - most projects use this name
        const statusFieldName = 'Status';

        const items = await this.api.getProjectItemsNormalized(project.id, {
            assignedToMe,
            statusFieldName,
        });

        this.projectItems.set(project.id, items);
        return items;
    }

    async getTreeItem(element: TreeElement): Promise<vscode.TreeItem> {
        switch (element.type) {
            case 'project':
                return this.createProjectTreeItem(element);
            case 'view':
                return this.createViewTreeItem(element);
            case 'statusGroup':
                return this.createStatusGroupTreeItem(element);
            case 'column':
                return this.createColumnTreeItem(element);
            case 'item':
                return await this.createItemTreeItem(element);
            case 'message':
                return this.createMessageTreeItem(element);
        }
    }

    async getChildren(element?: TreeElement): Promise<TreeElement[]> {
        // Root level - show projects
        if (!element) {
            if (!this.api.isAuthenticated) {
                return [
                    new MessageNode('Sign in to GitHub to view projects', {
                        command: 'ghProjects.signIn',
                        title: 'Sign In',
                    }),
                ];
            }

            if (this.loading) {
                return [new MessageNode('Loading projects...')];
            }

            if (this.projects.length === 0) {
                return [
                    new MessageNode('No projects found for this repository'),
                    new MessageNode('Check access permissions', {
                        command: 'ghProjects.showAccessHelp',
                        title: 'Help',
                    }),
                ];
            }

            return this.projects.map((p) => new ProjectNode(p));
        }

        // Project level - "My Stuff" mode: show status groups with assigned items
        if (element.type === 'project') {
            return await this.getMyStuffForProject(element.project);
        }

        // Status group level - show items
        if (element.type === 'statusGroup') {
            return element.items.map((item) => new ItemNode(item, element.project));
        }

        // Column level (legacy support for view detail)
        if (element.type === 'column') {
            return element.items.map((item) => new ItemNode(item, element.project));
        }

        return [];
    }

    /**
     * "My Stuff" view - shows items assigned to current user grouped by status
     */
    private async getMyStuffForProject(project: ProjectWithViews): Promise<TreeElement[]> {
        const config = vscode.workspace.getConfiguration('ghProjects');
        const hiddenStatuses = config.get<string[]>('myStuffHiddenStatuses', ['Done', 'Closed']);

        // Always filter to current user's items in "My Stuff" view
        const allItems = await this.api.getProjectItemsNormalized(project.id, {
            assignedToMe: true,
            statusFieldName: 'Status',
        });

        // Cache for other uses
        this.projectItems.set(project.id, allItems);

        // Filter out hidden statuses
        const visibleItems = allItems.filter((item) => {
            const status = item.status || 'No Status';
            return !hiddenStatuses.some(
                (h) => h.toLowerCase() === status.toLowerCase()
            );
        });

        if (visibleItems.length === 0) {
            if (allItems.length > 0) {
                return [new MessageNode(`All ${allItems.length} items are in hidden statuses`)];
            }
            return [new MessageNode('No items assigned to you')];
        }

        // Get status order from project
        const statusOrder = await this.api.getProjectStatusOptions(project.id);

        // Check if we should show empty status groups
        const statusConfig = vscode.workspace.getConfiguration('ghProjects');
        const showEmptyStatuses = statusConfig.get<boolean>('showEmptyColumns', false);

        // Group items by status
        const itemsByStatus = new Map<string, NormalizedProjectItem[]>();
        for (const item of visibleItems) {
            const status = item.status || 'No Status';
            if (!itemsByStatus.has(status)) {
                itemsByStatus.set(status, []);
            }
            itemsByStatus.get(status)!.push(item);
        }

        // Create status groups in order
        const groups: StatusGroupNode[] = [];

        for (const status of statusOrder) {
            const items = itemsByStatus.get(status) || [];
            const isHidden = hiddenStatuses.some(h => h.toLowerCase() === status.toLowerCase());

            // Show if has items, OR if showEmpty is enabled AND not hidden
            if (items.length > 0 || (showEmptyStatuses && !isHidden)) {
                groups.push(new StatusGroupNode(status, items, project));
            }
            itemsByStatus.delete(status);
        }

        // Add any remaining statuses not in the order (only if they have items)
        for (const [status, items] of itemsByStatus) {
            if (items.length > 0) {
                groups.push(new StatusGroupNode(status, items, project));
            }
        }

        return groups;
    }

    /**
     * Get columns for a board view - uses actual status order from project configuration
     */
    private async getColumnsForView(
        view: ProjectV2View,
        project: ProjectWithViews,
        items: NormalizedProjectItem[]
    ): Promise<ColumnNode[]> {
        // Group items by their status value
        const itemsByColumn = new Map<string, NormalizedProjectItem[]>();

        for (const item of items) {
            const columnValue = item.status || 'No Status';
            if (!itemsByColumn.has(columnValue)) {
                itemsByColumn.set(columnValue, []);
            }
            itemsByColumn.get(columnValue)!.push(item);
        }

        // Get actual status order from the project (matches GitHub's configuration)
        const statusOrder = await this.api.getProjectStatusOptions(project.id);

        // Create columns from the values we found
        const columns: ColumnNode[] = [];
        const config = vscode.workspace.getConfiguration('ghProjects');
        const showEmptyColumns = config.get<boolean>('showEmptyColumns', false);

        // Add columns in project's configured order
        for (const status of statusOrder) {
            const columnItems = itemsByColumn.get(status) || [];
            if (columnItems.length > 0 || showEmptyColumns) {
                columns.push(new ColumnNode(status, undefined, columnItems, view, project));
            }
            itemsByColumn.delete(status);
        }

        // Add any remaining columns that aren't in the status field (shouldn't happen often)
        const remaining = Array.from(itemsByColumn.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        for (const [name, columnItems] of remaining) {
            columns.push(new ColumnNode(name, undefined, columnItems, view, project));
        }

        return columns;
    }

    // Tree item creators
    private createProjectTreeItem(node: ProjectNode): vscode.TreeItem {
        const item = new vscode.TreeItem(
            node.project.title,
            vscode.TreeItemCollapsibleState.Expanded
        );
        item.iconPath = new vscode.ThemeIcon('project');
        item.contextValue = 'project';

        // Show "My Stuff" indicator - actual count will be shown in status groups
        item.description = 'My Items';

        const tooltip = new vscode.MarkdownString();
        tooltip.appendMarkdown(`**${node.project.title}**\n\n`);
        if (node.project.shortDescription) {
            tooltip.appendMarkdown(`${node.project.shortDescription}\n\n`);
        }
        tooltip.appendMarkdown(`*Items assigned to you*\n\n`);
        tooltip.appendMarkdown(`Use **Open Planning Board** for full kanban view`);
        item.tooltip = tooltip;

        return item;
    }

    private createViewTreeItem(node: ViewNode): vscode.TreeItem {
        const layoutIcons: Record<string, string> = {
            'BOARD_LAYOUT': 'layout',
            'TABLE_LAYOUT': 'table',
            'ROADMAP_LAYOUT': 'calendar',
        };

        const layoutNames: Record<string, string> = {
            'BOARD_LAYOUT': 'Board',
            'TABLE_LAYOUT': 'Table',
            'ROADMAP_LAYOUT': 'Roadmap',
        };

        const item = new vscode.TreeItem(
            node.view.name,
            vscode.TreeItemCollapsibleState.Collapsed
        );
        item.iconPath = new vscode.ThemeIcon(layoutIcons[node.view.layout] || 'list-flat');
        item.description = layoutNames[node.view.layout] || node.view.layout;
        item.contextValue = 'view';

        // Show groupBy info in tooltip (if available)
        const groupBy = node.view.groupByFields?.nodes?.[0];
        if (groupBy?.name) {
            item.tooltip = `Grouped by: ${groupBy.name}`;
        }

        return item;
    }

    private createStatusGroupTreeItem(node: StatusGroupNode): vscode.TreeItem {
        const item = new vscode.TreeItem(
            node.status,
            node.items.length > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None
        );

        item.description = `${node.items.length}`;
        item.contextValue = 'statusGroup';
        item.iconPath = this.getStatusIcon(node.status);

        return item;
    }

    private getStatusIcon(status: string): vscode.ThemeIcon {
        const nameLower = status.toLowerCase();

        if (nameLower.includes('done') || nameLower.includes('complete')) {
            return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'));
        }
        if (nameLower.includes('progress') || nameLower.includes('doing') || nameLower.includes('working')) {
            return new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.yellow'));
        }
        if (nameLower.includes('review')) {
            return new vscode.ThemeIcon('eye', new vscode.ThemeColor('charts.purple'));
        }
        if (nameLower.includes('block')) {
            return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
        }
        if (nameLower.includes('kill')) {
            return new vscode.ThemeIcon('target', new vscode.ThemeColor('charts.orange'));
        }
        if (nameLower.includes('todo') || nameLower.includes('backlog') || nameLower.includes('ready')) {
            return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.blue'));
        }

        return new vscode.ThemeIcon('circle-filled');
    }

    private createColumnTreeItem(node: ColumnNode): vscode.TreeItem {
        const item = new vscode.TreeItem(
            node.name,
            node.items.length > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None
        );

        item.description = `${node.items.length}`;
        item.contextValue = 'column';

        // Use GitHub's color if available
        item.iconPath = this.getColumnIcon(node.name, node.color);

        return item;
    }

    private getColumnIcon(name: string, color?: string): vscode.ThemeIcon {
        // Map GitHub colors to VS Code theme colors
        const colorMap: Record<string, string> = {
            'GRAY': 'charts.gray',
            'BLUE': 'charts.blue',
            'GREEN': 'charts.green',
            'YELLOW': 'charts.yellow',
            'ORANGE': 'charts.orange',
            'RED': 'charts.red',
            'PINK': 'charts.pink',
            'PURPLE': 'charts.purple',
        };

        const themeColor = color ? colorMap[color.toUpperCase()] : undefined;

        // Also try to infer from name if no color
        const nameLower = name.toLowerCase();
        let icon = 'circle-filled';

        if (nameLower.includes('done') || nameLower.includes('complete')) {
            return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'));
        }
        if (nameLower.includes('progress') || nameLower.includes('doing')) {
            return new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.yellow'));
        }
        if (nameLower.includes('review')) {
            return new vscode.ThemeIcon('eye', new vscode.ThemeColor('charts.purple'));
        }
        if (nameLower.includes('block')) {
            return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
        }
        if (nameLower.includes('kill')) {
            return new vscode.ThemeIcon('target', new vscode.ThemeColor('charts.orange'));
        }

        return new vscode.ThemeIcon(
            icon,
            themeColor ? new vscode.ThemeColor(themeColor) : undefined
        );
    }

    private async createItemTreeItem(node: ItemNode): Promise<vscode.TreeItem> {
        const { item } = node;

        // Check if this item is the "currently working on" item
        const isActive = this.isActiveItem(item);

        // Show issue number before title for visibility
        const label = item.number ? `#${item.number} ${item.title}` : item.title;
        const treeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);

        // Check for linked branch (only for issues with a number)
        const linkedBranch = item.number
            ? (await this.branchLinker?.getBranchForIssue(item.number)) || null
            : null;

        // Description: repo (for cross-repo items) + branch indicator + active badge
        let description = '';
        if (item.repository) {
            description = item.repository;
        }

        // Add branch indicator with git-branch icon
        if (linkedBranch) {
            description += description ? ` $(git-branch) ${linkedBranch}` : `$(git-branch) ${linkedBranch}`;
        }

        // Add subtle active indicator
        if (isActive) {
            description = `$(circle-filled) ${description}`;
        }

        treeItem.description = description;

        // Icon based on type and state (with active highlight)
        treeItem.iconPath = this.getItemIcon(item, isActive);
        treeItem.contextValue = 'projectItem';

        // Tooltip with details
        const md = new vscode.MarkdownString();
        if (isActive) {
            md.appendMarkdown(`🔥 **Currently Working On**\n\n`);
        }
        md.appendMarkdown(`**${item.title}**\n\n`);
        if (item.status) md.appendMarkdown(`Status: ${item.status}\n\n`);
        if (item.assignees.length > 0) {
            md.appendMarkdown(`Assignees: ${item.assignees.map(a => a.login).join(', ')}\n\n`);
        }
        if (linkedBranch) {
            md.appendMarkdown(`🌿 Branch: \`${linkedBranch}\`\n\n`);
        }
        treeItem.tooltip = md;

        // Click to open detail panel
        treeItem.command = {
            command: 'ghProjects.showItemDetail',
            title: 'Show Details',
            arguments: [node],
        };

        return treeItem;
    }

    /**
     * Check if an item has the "active" label indicating it's currently being worked on.
     */
    private isActiveItem(item: NormalizedProjectItem): boolean {
        if (!this.api?.username) {
            return false;
        }
        const activeLabel = `@${this.api.username}:active`;
        return item.labels.some(l => l.name === activeLabel);
    }

    private getItemIcon(item: NormalizedProjectItem, isActive: boolean = false): vscode.ThemeIcon {
        // Active items get green, inactive get muted grey
        const activeColor = new vscode.ThemeColor('charts.green');
        const inactiveColor = new vscode.ThemeColor('descriptionForeground');

        if (item.type === 'pr') {
            if (item.state === 'merged') {
                return new vscode.ThemeIcon('git-merge', new vscode.ThemeColor('charts.purple'));
            }
            if (item.state === 'closed') {
                return new vscode.ThemeIcon('git-pull-request-closed', new vscode.ThemeColor('charts.red'));
            }
            return new vscode.ThemeIcon('git-pull-request', isActive ? activeColor : inactiveColor);
        }

        if (item.type === 'draft') {
            return new vscode.ThemeIcon('note', isActive ? activeColor : inactiveColor);
        }

        // Issue
        if (item.state === 'closed') {
            return new vscode.ThemeIcon('issue-closed', new vscode.ThemeColor('charts.purple'));
        }
        return new vscode.ThemeIcon('issue-opened', isActive ? activeColor : inactiveColor);
    }

    private createMessageTreeItem(node: MessageNode): vscode.TreeItem {
        const item = new vscode.TreeItem(node.message);
        if (node.action) {
            item.command = {
                command: node.action.command,
                title: node.action.title,
            };
        }
        return item;
    }
}

/**
 * Drag-and-drop controller for moving items between status groups
 */
export class ProjectItemDragAndDropController implements vscode.TreeDragAndDropController<TreeElement> {
    readonly dropMimeTypes = ['application/vnd.code.tree.ghprojects.item'];
    readonly dragMimeTypes = ['application/vnd.code.tree.ghprojects.item'];

    constructor(
        private api: GitHubAPI,
        private boardProvider: ProjectBoardProvider
    ) {}

    handleDrag(
        source: readonly TreeElement[],
        dataTransfer: vscode.DataTransfer,
        _token: vscode.CancellationToken
    ): void {
        // Only allow dragging ItemNodes
        const items = source.filter((el): el is ItemNode => el.type === 'item');
        if (items.length === 0) {
            return;
        }

        // Serialize the dragged items
        const dragData = items.map(node => ({
            itemId: node.item.id,
            projectId: node.project.id,
            currentStatus: node.item.status,
            title: node.item.title,
        }));

        dataTransfer.set(
            'application/vnd.code.tree.ghprojects.item',
            new vscode.DataTransferItem(dragData)
        );
    }

    async handleDrop(
        target: TreeElement | undefined,
        dataTransfer: vscode.DataTransfer,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Must drop onto a StatusGroupNode
        if (!target || target.type !== 'statusGroup') {
            return;
        }

        const transferItem = dataTransfer.get('application/vnd.code.tree.ghprojects.item');
        if (!transferItem) {
            return;
        }

        const dragData = transferItem.value as Array<{
            itemId: string;
            projectId: string;
            currentStatus: string | null;
            title: string;
        }>;

        const targetStatus = target.status;
        const project = target.project;

        // Find the Status field and target option
        const statusInfo = this.api.findStatusFieldAndOptionFromProject(project, targetStatus);
        if (!statusInfo) {
            vscode.window.showErrorMessage(`Could not find status "${targetStatus}" in project`);
            return;
        }

        // Update each dragged item
        for (const item of dragData) {
            if (item.currentStatus === targetStatus) {
                continue; // Already in this status
            }

            try {
                const success = await this.api.updateItemStatus(
                    project.id,
                    item.itemId,
                    statusInfo.fieldId,
                    statusInfo.optionId
                );

                if (success) {
                    vscode.window.showInformationMessage(
                        `Moved "${item.title}" to ${targetStatus}`
                    );
                } else {
                    vscode.window.showErrorMessage(
                        `Failed to move "${item.title}"`
                    );
                }
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Error moving "${item.title}": ${error}`
                );
            }
        }

        // Refresh the tree to show updated positions
        this.boardProvider.refresh();
    }
}

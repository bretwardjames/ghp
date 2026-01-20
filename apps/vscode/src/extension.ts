import * as vscode from 'vscode';
import { GitHubAPI } from './github-api';
import { ProjectBoardProvider, ItemNode, ViewNode, ProjectItemDragAndDropController } from './tree-provider';
import { detectRepository, type RepoInfo } from './repo-detector';
import { StatusBarManager, showAccessHelp } from './status-bar';
import { executeStartWorking } from './start-working';
import { IssueDetailPanel } from './issue-detail-panel';
import { PlanningBoardPanel } from './planning-board';
import { executePROpened } from './pr-workflow';
import { BranchLinker } from './branch-linker';
import { executeSyncSettings } from './settings-sync';

let api: GitHubAPI;
let boardProvider: ProjectBoardProvider;
let statusBar: StatusBarManager;
let branchLinker: BranchLinker;
let currentRepo: RepoInfo | null = null;

export async function activate(context: vscode.ExtensionContext) {
    console.log('GitHub Projects extension is now active');

    // Initialize components
    api = new GitHubAPI();
    boardProvider = new ProjectBoardProvider(api);
    statusBar = new StatusBarManager();

    // BranchLinker now needs API and a way to get repo info
    branchLinker = new BranchLinker(api, () => currentRepo);

    // Connect branch linker to board provider for linked branch indicators
    boardProvider.setBranchLinker(branchLinker);

    statusBar.show();

    // Create drag-and-drop controller for moving items between statuses
    const dragDropController = new ProjectItemDragAndDropController(api, boardProvider);

    // Register tree view - single unified view showing project boards
    const boardView = vscode.window.createTreeView('ghProjects.board', {
        treeDataProvider: boardProvider,
        showCollapseAll: true,
        dragAndDropController: dragDropController,
        canSelectMany: true, // Allow multi-select for bulk moves
    });

    context.subscriptions.push(boardView, statusBar);

    // Register commands
    registerCommands(context);

    // Listen for workspace changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(async () => {
            await loadProjects();
        }),
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('ghProjects')) {
                boardProvider.refresh();
            }
        })
    );

    // Initialize on startup
    await initialize();
}

function registerCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ghProjects.signIn', async () => {
            const success = await api.authenticate();
            if (success) {
                vscode.window.showInformationMessage(`Signed in as ${api.username}`);
                await loadProjects();
            } else {
                vscode.window.showErrorMessage('Failed to sign in to GitHub');
            }
        }),

        vscode.commands.registerCommand('ghProjects.refresh', async () => {
            await loadProjects();
        }),

        vscode.commands.registerCommand('ghProjects.openItem', async (arg: unknown) => {
            let url: string | null = null;

            if (typeof arg === 'string') {
                // Called with URL directly (e.g., from planning board)
                url = arg;
            } else if (arg instanceof ItemNode && arg.item.url) {
                // Called from tree view context menu
                url = arg.item.url;
            }

            if (url) {
                await vscode.env.openExternal(vscode.Uri.parse(url));
            }
        }),

        vscode.commands.registerCommand('ghProjects.showItemDetail', async (node: unknown) => {
            if (node instanceof ItemNode) {
                await IssueDetailPanel.show(api, node.item, node.project);
            }
        }),

        vscode.commands.registerCommand('ghProjects.changeItemStatus', async (node: unknown) => {
            if (node instanceof ItemNode) {
                const statusOptions = await api.getProjectStatusOptions(node.project.id);
                if (statusOptions.length === 0) {
                    vscode.window.showErrorMessage('No status options found for this project');
                    return;
                }

                const selected = await vscode.window.showQuickPick(statusOptions, {
                    placeHolder: 'Select new status',
                    title: `Move "${node.item.title}" to...`,
                });

                if (selected) {
                    const success = await api.updateItemStatusByName(
                        node.project.id,
                        node.item.id,
                        selected
                    );

                    if (success) {
                        vscode.window.showInformationMessage(`Status changed to "${selected}"`);
                        boardProvider.refresh();
                    } else {
                        vscode.window.showErrorMessage('Failed to update status');
                    }
                }
            }
        }),

        vscode.commands.registerCommand('ghProjects.showAccessHelp', showAccessHelp),

        vscode.commands.registerCommand('ghProjects.hideView', async (node: unknown) => {
            if (node instanceof ViewNode) {
                const config = vscode.workspace.getConfiguration('ghProjects');
                const hiddenViews = config.get<string[]>('hiddenViews', []);

                if (!hiddenViews.includes(node.view.name)) {
                    hiddenViews.push(node.view.name);
                    await config.update('hiddenViews', hiddenViews, vscode.ConfigurationTarget.Workspace);
                    boardProvider.refresh();
                    vscode.window.showInformationMessage(`View "${node.view.name}" hidden. Use "Show Hidden Views" to restore.`);
                }
            }
        }),

        vscode.commands.registerCommand('ghProjects.showHiddenViews', async () => {
            const config = vscode.workspace.getConfiguration('ghProjects');
            const hiddenViews = config.get<string[]>('hiddenViews', []);

            if (hiddenViews.length === 0) {
                vscode.window.showInformationMessage('No hidden views');
                return;
            }

            const selected = await vscode.window.showQuickPick(
                hiddenViews.map((name) => ({ label: name, picked: false })),
                {
                    canPickMany: true,
                    placeHolder: 'Select views to show again',
                    title: 'Hidden Views',
                }
            );

            if (selected && selected.length > 0) {
                const toShow = selected.map((s) => s.label);
                const newHidden = hiddenViews.filter((v) => !toShow.includes(v));
                await config.update('hiddenViews', newHidden, vscode.ConfigurationTarget.Workspace);
                boardProvider.refresh();
                vscode.window.showInformationMessage(`Restored ${selected.length} view(s)`);
            }
        }),

        vscode.commands.registerCommand('ghProjects.configureProject', async () => {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'ghProjects');
        }),

        vscode.commands.registerCommand('ghProjects.syncSettings', async () => {
            await executeSyncSettings();
        }),

        vscode.commands.registerCommand('ghProjects.openProjectInBrowser', async (url: string) => {
            if (url) {
                await vscode.env.openExternal(vscode.Uri.parse(url));
            }
        }),

        vscode.commands.registerCommand('ghProjects.debugAuth', async () => {
            // Debug command to help diagnose authentication issues
            const output = vscode.window.createOutputChannel('GitHub Projects Debug');
            output.show();
            output.appendLine('=== GitHub Projects Authentication Debug ===\n');

            try {
                const session = await vscode.authentication.getSession('github', ['project', 'repo'], {
                    createIfNone: false,
                });

                if (!session) {
                    output.appendLine('❌ No GitHub session found. Please sign in first.');
                    return;
                }

                output.appendLine(`✅ Authenticated as: ${session.account.label}`);
                output.appendLine(`   Scopes requested: project, repo`);
                output.appendLine(`   Session ID: ${session.id.substring(0, 8)}...`);
                output.appendLine('');

                // Test basic API access
                const { graphql } = await import('@octokit/graphql');
                const client = graphql.defaults({
                    headers: { authorization: `token ${session.accessToken}` },
                });

                // Test viewer query
                const viewerResult = await client<{ viewer: { login: string; organizations: { nodes: Array<{ login: string }> } } }>(`
                    query {
                        viewer {
                            login
                            organizations(first: 10) {
                                nodes {
                                    login
                                }
                            }
                        }
                    }
                `);
                output.appendLine(`✅ API connection works`);
                output.appendLine(`   User: ${viewerResult.viewer.login}`);
                output.appendLine(`   Visible orgs: ${viewerResult.viewer.organizations.nodes.map(o => o.login).join(', ') || 'none'}`);
                output.appendLine('');

                // Test current repo
                const repo = await detectRepository();
                if (repo) {
                    output.appendLine(`📁 Current repository: ${repo.fullName}`);
                    output.appendLine('');

                    // Try to access repo projects
                    try {
                        const repoResult = await client<{ repository: { projectsV2: { totalCount: number } } }>(`
                            query($owner: String!, $name: String!) {
                                repository(owner: $owner, name: $name) {
                                    projectsV2(first: 1) {
                                        totalCount
                                    }
                                }
                            }
                        `, { owner: repo.owner, name: repo.name });
                        output.appendLine(`✅ Repo projects access: ${repoResult.repository.projectsV2.totalCount} projects found`);
                    } catch (e) {
                        output.appendLine(`❌ Repo projects access failed: ${e instanceof Error ? e.message : String(e)}`);
                        output.appendLine('');
                        output.appendLine('💡 If this is an org repo with SSO, you may need to authorize the token:');
                        output.appendLine('   1. Go to github.com/settings/connections/applications');
                        output.appendLine('   2. Find "Visual Studio Code" or "Cursor"');
                        output.appendLine('   3. Click "Configure" and authorize for your organization');
                    }

                    // Try org projects if owner looks like an org
                    try {
                        const orgResult = await client<{ organization: { projectsV2: { totalCount: number } } }>(`
                            query($owner: String!) {
                                organization(login: $owner) {
                                    projectsV2(first: 1) {
                                        totalCount
                                    }
                                }
                            }
                        `, { owner: repo.owner });
                        output.appendLine(`✅ Org projects access (${repo.owner}): ${orgResult.organization.projectsV2.totalCount} projects found`);
                    } catch (e) {
                        const errorMsg = e instanceof Error ? e.message : String(e);
                        if (errorMsg.includes('Could not resolve to an Organization')) {
                            output.appendLine(`ℹ️  ${repo.owner} is not an organization (user account)`);
                        } else {
                            output.appendLine(`❌ Org projects access failed: ${errorMsg}`);
                        }
                    }
                } else {
                    output.appendLine('ℹ️  No git repository detected in current workspace');
                }

            } catch (e) {
                output.appendLine(`❌ Error: ${e instanceof Error ? e.message : String(e)}`);
            }

            output.appendLine('\n=== End Debug ===');
        }),

        vscode.commands.registerCommand('ghProjects.startWorking', async (node: unknown) => {
            // The node comes from the tree view context menu
            if (node instanceof ItemNode) {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Starting work...',
                        cancellable: false,
                    },
                    async () => {
                        const success = await executeStartWorking(api, {
                            item: node.item,
                            project: node.project,
                        });

                        if (success) {
                            // Refresh to show updated status
                            boardProvider.refresh();
                        }
                    }
                );
            } else {
                vscode.window.showErrorMessage('Please select an issue or PR to start working on');
            }
        }),

        vscode.commands.registerCommand('ghProjects.openPlanningMode', async () => {
            if (!api.isAuthenticated) {
                const signIn = await vscode.window.showWarningMessage(
                    'Please sign in to GitHub to use Planning Mode',
                    'Sign In'
                );
                if (signIn) {
                    await vscode.commands.executeCommand('ghProjects.signIn');
                }
                return;
            }

            if (!currentRepo) {
                vscode.window.showWarningMessage('No repository detected. Open a folder with a git repository.');
                return;
            }

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Opening Planning Board...',
                    cancellable: false,
                },
                async () => {
                    const projects = await api.getProjectsWithViews(currentRepo!);
                    if (projects.length === 0) {
                        vscode.window.showWarningMessage('No GitHub Projects found for this repository.');
                        return;
                    }
                    await PlanningBoardPanel.show(api, currentRepo!, projects);
                }
            );
        }),

        vscode.commands.registerCommand('ghProjects.configurePlanningViews', async () => {
            await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'ghProjects.planningModeViews'
            );
        }),

        vscode.commands.registerCommand('ghProjects.prOpened', async () => {
            if (!api.isAuthenticated) {
                vscode.window.showWarningMessage('Please sign in to GitHub first');
                return;
            }

            if (!currentRepo) {
                vscode.window.showWarningMessage('No repository detected');
                return;
            }

            const projects = await api.getProjectsWithViews(currentRepo);
            const success = await executePROpened(api, projects);
            if (success) {
                boardProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('ghProjects.newIssue', async () => {
            if (!api.isAuthenticated) {
                const signIn = await vscode.window.showWarningMessage(
                    'Please sign in to GitHub to create issues',
                    'Sign In'
                );
                if (signIn) {
                    await vscode.commands.executeCommand('ghProjects.signIn');
                }
                return;
            }

            if (!currentRepo) {
                vscode.window.showWarningMessage('No repository detected. Open a folder with a git repository.');
                return;
            }

            // Open planning board with new issue form
            const projects = await api.getProjectsWithViews(currentRepo);
            if (projects.length === 0) {
                vscode.window.showWarningMessage('No GitHub Projects found for this repository.');
                return;
            }

            await PlanningBoardPanel.show(api, currentRepo, projects);
            // Trigger the new issue form after the panel is shown
            setTimeout(() => {
                PlanningBoardPanel.currentPanel?.triggerNewIssue();
            }, 500);
        }),

        vscode.commands.registerCommand('ghProjects.linkBranch', async (node: unknown) => {
            if (!(node instanceof ItemNode)) {
                vscode.window.showErrorMessage('Please select an issue to link a branch to');
                return;
            }

            const item = node.item;
            if (item.type !== 'issue') {
                vscode.window.showWarningMessage('Branch linking is only available for issues');
                return;
            }

            if (!item.number) {
                vscode.window.showWarningMessage('Issue number not available');
                return;
            }

            // Get current linked branch if any
            const currentLinked = await branchLinker.getBranchForIssue(item.number);

            // Check current branch status
            const { pushed, branchName: currentBranch } = await branchLinker.isCurrentBranchPushed();

            // If current branch isn't pushed, offer to push it first
            if (currentBranch && !pushed) {
                const pushChoice = await vscode.window.showInformationMessage(
                    `Your current branch "${currentBranch}" hasn't been pushed yet. Push it to link to this issue?`,
                    'Push and Link',
                    'Select Different Branch',
                    'Cancel'
                );

                if (pushChoice === 'Cancel' || !pushChoice) {
                    return;
                }

                if (pushChoice === 'Push and Link') {
                    const pushResult = await vscode.window.withProgress(
                        { location: vscode.ProgressLocation.Notification, title: 'Pushing branch...' },
                        () => branchLinker.pushCurrentBranch()
                    );

                    if (!pushResult.success) {
                        vscode.window.showErrorMessage(`Failed to push: ${pushResult.error}`);
                        return;
                    }

                    // Link the just-pushed branch
                    await branchLinker.linkBranch(currentBranch, item.number);
                    vscode.window.showInformationMessage(
                        `Pushed and linked branch "${currentBranch}" to #${item.number}`
                    );
                    boardProvider.refresh();
                    return;
                }
                // Otherwise fall through to select different branch
            }

            // Fetch and show remote branches
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Fetching remote branches...' },
                () => branchLinker.getRemoteBranches() // This does a git fetch
            );

            const remoteBranches = await branchLinker.getRemoteBranches();
            if (remoteBranches.length === 0) {
                vscode.window.showWarningMessage('No remote branches found');
                return;
            }

            // Build quick pick items
            const items: vscode.QuickPickItem[] = remoteBranches.map(branch => ({
                label: branch,
                description: branch === currentBranch ? '(current)' :
                             branch === currentLinked ? '(currently linked)' : undefined,
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Select remote branch to link to #${item.number}: ${item.title}`,
                title: 'Link Branch to Issue',
            });

            if (selected) {
                await branchLinker.linkBranch(selected.label, item.number);
                vscode.window.showInformationMessage(
                    `Linked branch "${selected.label}" to #${item.number}`
                );
                boardProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('ghProjects.switchToBranch', async (node: unknown) => {
            if (!(node instanceof ItemNode)) {
                vscode.window.showErrorMessage('Please select an issue to switch to its branch');
                return;
            }

            const item = node.item;
            if (!item.number) {
                vscode.window.showWarningMessage('Issue number not available');
                return;
            }
            const linkedBranch = await branchLinker.getBranchForIssue(item.number);

            if (!linkedBranch) {
                // No branch linked - offer to link one or start working
                const choice = await vscode.window.showWarningMessage(
                    `No branch linked to #${item.number}. What would you like to do?`,
                    'Link Existing Branch',
                    'Start Working (Create New)',
                    'Cancel'
                );

                if (choice === 'Link Existing Branch') {
                    await vscode.commands.executeCommand('ghProjects.linkBranch', node);
                } else if (choice === 'Start Working (Create New)') {
                    await vscode.commands.executeCommand('ghProjects.startWorking', node);
                }
                return;
            }

            // Check if branch still exists (locally or on remote)
            const existsLocally = await branchLinker.branchExists(linkedBranch);
            const existsRemotely = await branchLinker.remoteBranchExists(linkedBranch);

            if (!existsLocally && !existsRemotely) {
                const relink = await vscode.window.showWarningMessage(
                    `Branch "${linkedBranch}" no longer exists locally or on remote. Would you like to link a different branch?`,
                    'Link Different Branch',
                    'Cancel'
                );
                if (relink === 'Link Different Branch') {
                    await vscode.commands.executeCommand('ghProjects.linkBranch', node);
                }
                return;
            }

            // Check if already on this branch
            const currentBranch = await branchLinker.getCurrentBranch();
            if (currentBranch === linkedBranch) {
                vscode.window.showInformationMessage(`Already on branch "${linkedBranch}"`);
                return;
            }

            // Switch to the branch
            const result = await branchLinker.switchToBranch(linkedBranch);
            if (result.success) {
                vscode.window.showInformationMessage(`Switched to branch "${linkedBranch}"`);
            } else if (result.error && result.error !== 'Cancelled by user') {
                vscode.window.showErrorMessage(`Failed to switch branch: ${result.error}`);
            }
        }),

        vscode.commands.registerCommand('ghProjects.unlinkBranch', async (node: unknown) => {
            if (!(node instanceof ItemNode)) {
                return;
            }

            const item = node.item;
            if (!item.number) {
                vscode.window.showWarningMessage('Issue number not available');
                return;
            }
            const linkedBranch = await branchLinker.getBranchForIssue(item.number);

            if (!linkedBranch) {
                vscode.window.showInformationMessage('No branch is linked to this issue');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Unlink branch "${linkedBranch}" from #${item.number}?`,
                'Unlink',
                'Cancel'
            );

            if (confirm === 'Unlink') {
                await branchLinker.unlinkBranch(item.number);
                vscode.window.showInformationMessage(`Unlinked branch from #${item.number}`);
                boardProvider.refresh();
            }
        })
    );
}

// Export branchLinker for use in other modules
export function getBranchLinker(): BranchLinker {
    return branchLinker;
}

async function initialize() {
    statusBar.setLoading();

    const success = await api.authenticate();
    if (success) {
        await loadProjects();
    } else {
        statusBar.setError('Sign in required');
        boardProvider.refresh();
    }
}

async function loadProjects() {
    statusBar.setLoading();
    boardProvider.setLoading(true);

    // Detect current repository
    currentRepo = await detectRepository();

    if (!currentRepo) {
        statusBar.setNoRepo();
        boardProvider.setLoading(false);
        await boardProvider.setProjects([]);
        return;
    }

    if (!api.isAuthenticated) {
        statusBar.setError('Sign in required');
        boardProvider.setLoading(false);
        return;
    }

    try {
        // Fetch projects with their views
        const projects = await api.getProjectsWithViews(currentRepo);

        await boardProvider.setProjects(projects);
        boardProvider.setLoading(false);

        if (projects.length === 0) {
            statusBar.setNoProjects(currentRepo);
        } else {
            statusBar.setConnected(currentRepo, projects.length);
        }
    } catch (error) {
        console.error('Failed to load projects:', error);
        boardProvider.setLoading(false);

        const errorMessage = error instanceof Error ? error.message : String(error);

        // Check for SSO-related errors and offer to help
        if (errorMessage.includes('SSO Authorization Required')) {
            statusBar.setError('SSO authorization required');
            const action = await vscode.window.showErrorMessage(
                errorMessage,
                'Open GitHub Settings',
                'Re-authenticate'
            );
            if (action === 'Open GitHub Settings') {
                await vscode.env.openExternal(
                    vscode.Uri.parse('https://github.com/settings/connections/applications')
                );
            } else if (action === 'Re-authenticate') {
                // Clear the session and try again
                await vscode.commands.executeCommand('ghProjects.signIn');
            }
        } else {
            statusBar.setError('Failed to load projects');
            vscode.window.showErrorMessage(`GitHub Projects: ${errorMessage}`);
        }
    }
}

export function deactivate() {
    // Cleanup
}

import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, copyFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { GitHubAPI } from './github-api';
import { generateBranchName, branchExists, createBranch, checkoutBranch } from './git-utils';
import type { NormalizedProjectItem, ProjectWithViews } from './types';
import { getBranchLinker } from './extension';

const execAsync = promisify(exec);

export interface WorktreeInfo {
    path: string;
    head: string;
    branch: string | null;
    isMain: boolean;
}

export interface WorktreeConfig {
    path: string;
    copyFiles: string[];
    setupCommand: string;
    autoSetup: boolean;
}

/**
 * Get worktree configuration from VS Code settings
 */
export function getWorktreeConfig(): WorktreeConfig {
    const config = vscode.workspace.getConfiguration('ghProjects');
    return {
        path: config.get<string>('worktreePath', '~/.ghp/worktrees'),
        copyFiles: config.get<string[]>('worktreeCopyFiles', ['.env', '.env.local']),
        setupCommand: config.get<string>('worktreeSetupCommand', 'pnpm install'),
        autoSetup: config.get<boolean>('worktreeAutoSetup', true),
    };
}

/**
 * Expand ~ to home directory in a path
 */
function expandPath(path: string): string {
    return path.startsWith('~') ? join(homedir(), path.slice(1)) : path;
}

/**
 * Generate a worktree path for an issue
 */
export function generateWorktreePath(basePath: string, repoName: string, identifier: string | number): string {
    const expandedBase = expandPath(basePath);
    return join(expandedBase, repoName, String(identifier));
}

/**
 * Get workspace root folder
 */
function getWorkspaceRoot(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    return workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * List all worktrees for the repository
 */
export async function listWorktrees(): Promise<WorktreeInfo[]> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return [];
    }

    try {
        const { stdout } = await execAsync('git worktree list --porcelain', { cwd: workspaceRoot });
        const worktrees: WorktreeInfo[] = [];

        const entries = stdout.trim().split('\n\n');

        for (const entry of entries) {
            if (!entry.trim()) continue;

            const lines = entry.split('\n');
            const info: Partial<WorktreeInfo> = {
                isMain: false,
                branch: null,
            };

            for (const line of lines) {
                if (line.startsWith('worktree ')) {
                    info.path = line.substring(9);
                } else if (line.startsWith('HEAD ')) {
                    info.head = line.substring(5);
                } else if (line.startsWith('branch ')) {
                    info.branch = line.substring(7).replace(/^refs\/heads\//, '');
                } else if (line === 'bare') {
                    info.isMain = true;
                }
            }

            if (worktrees.length === 0) {
                info.isMain = true;
            }

            if (info.path && info.head) {
                worktrees.push(info as WorktreeInfo);
            }
        }

        return worktrees;
    } catch {
        return [];
    }
}

/**
 * Get worktree for a specific branch
 */
export async function getWorktreeForBranch(branch: string): Promise<WorktreeInfo | null> {
    const worktrees = await listWorktrees();
    return worktrees.find(wt => wt.branch === branch) || null;
}

/**
 * Create a worktree for a branch
 */
export async function createWorktree(worktreePath: string, branch: string): Promise<void> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        throw new Error('No workspace folder open');
    }

    // Check if branch exists locally
    const localExists = await branchExists(branch);

    if (localExists) {
        await execAsync(`git worktree add "${worktreePath}" "${branch}"`, { cwd: workspaceRoot });
    } else {
        try {
            await execAsync(`git worktree add "${worktreePath}" -b "${branch}" "origin/${branch}"`, { cwd: workspaceRoot });
        } catch {
            await execAsync(`git worktree add -b "${branch}" "${worktreePath}"`, { cwd: workspaceRoot });
        }
    }
}

/**
 * Setup a worktree: copy files and run setup command
 */
export async function setupWorktree(worktreePath: string, sourcePath: string): Promise<void> {
    const config = getWorktreeConfig();

    // Copy configured files
    for (const file of config.copyFiles) {
        const srcFile = join(sourcePath, file);
        const destFile = join(worktreePath, file);

        if (existsSync(srcFile)) {
            const destDir = dirname(destFile);
            if (!existsSync(destDir)) {
                mkdirSync(destDir, { recursive: true });
            }
            copyFileSync(srcFile, destFile);
        }
    }

    // Run setup command if enabled
    if (config.autoSetup && config.setupCommand) {
        await execAsync(config.setupCommand, { cwd: worktreePath });
    }
}

export interface StartInWorktreeContext {
    item: NormalizedProjectItem;
    project: ProjectWithViews;
}

/**
 * Start working on an issue in a parallel worktree
 */
export async function executeStartInWorktree(
    api: GitHubAPI,
    context: StartInWorktreeContext
): Promise<{ success: boolean; worktreePath?: string }> {
    const config = vscode.workspace.getConfiguration('ghProjects');
    const branchPattern = config.get<string>('branchNamePattern', '{user}/{number}-{title}');
    const targetStatus = config.get<string>('startWorkingStatus', 'In Progress');
    const maxLength = config.get<number>('maxBranchNameLength', 60);

    const { item, project } = context;
    const branchLinker = getBranchLinker();
    const wtConfig = getWorktreeConfig();

    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open');
        return { success: false };
    }

    // Get repository name for worktree path
    const repoName = item.repository?.split('/')[1] || 'unknown';

    // Check if issue has a linked branch
    let branchName = item.number ? await branchLinker.getBranchForIssue(item.number) : null;

    // If no linked branch, create one
    if (!branchName) {
        branchName = generateBranchName(
            branchPattern,
            {
                user: api.username || 'user',
                number: item.number,
                title: item.title,
                repo: item.repository,
            },
            maxLength
        );

        // Check if this branch exists - if so, just use it without creating
        if (!(await branchExists(branchName))) {
            await createBranch(branchName);
        }

        // Link the branch to the issue
        if (item.number) {
            await branchLinker.linkBranch(branchName, item.number);
        }
    }

    // Generate worktree path
    const worktreePath = generateWorktreePath(wtConfig.path, repoName, item.number || branchName);

    // Check if worktree already exists for this branch
    const existingWorktree = await getWorktreeForBranch(branchName);
    if (existingWorktree) {
        if (existingWorktree.isMain) {
            // Branch is checked out in main worktree - switch main to default branch first
            const mainBranch = config.get<string>('mainBranch', 'main');
            try {
                await checkoutBranch(mainBranch);
            } catch {
                vscode.window.showErrorMessage(
                    `Branch "${branchName}" is checked out in main workspace. ` +
                    `Failed to switch to ${mainBranch}. You may have uncommitted changes.`
                );
                return { success: false };
            }
        } else {
            // Non-main worktree already exists
            vscode.window.showInformationMessage(`Worktree already exists at: ${existingWorktree.path}`);
            return { success: true, worktreePath: existingWorktree.path };
        }
    }

    // Ensure parent directory exists
    const parentDir = dirname(worktreePath);
    if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
    }

    // Create the worktree
    await createWorktree(worktreePath, branchName);

    // Setup the worktree (copy files, run setup command)
    await setupWorktree(worktreePath, workspaceRoot);

    // Update project item status if configured
    if (targetStatus) {
        const statusInfo = api.findStatusFieldAndOption(project, targetStatus);
        if (statusInfo) {
            await api.updateItemStatus(project.id, item.id, statusInfo.fieldId, statusInfo.optionId);
        }
    }

    // Apply active label (non-exclusive for parallel work)
    await applyActiveLabelNonExclusive(api, item);

    return { success: true, worktreePath };
}

/**
 * Apply the active label without removing from other issues (for parallel work)
 */
async function applyActiveLabelNonExclusive(api: GitHubAPI, item: NormalizedProjectItem): Promise<void> {
    if (!item.number || !item.repository) {
        return;
    }

    const [owner, repo] = item.repository.split('/');
    if (!owner || !repo) {
        return;
    }

    try {
        const labelName = api.getActiveLabelName();

        // Ensure the label exists
        await api.ensureLabel(owner, repo, labelName, '1d76db', `Currently active issue for @${api.username}`);

        // Just add the label, don't remove from others
        await api.addLabelToIssue(owner, repo, item.number, labelName);
    } catch (error) {
        console.warn('Failed to apply active label:', error);
    }
}

/**
 * Find worktree for an issue (via linked branch)
 */
export async function getWorktreeForIssue(issueNumber: number): Promise<WorktreeInfo | null> {
    const branchLinker = getBranchLinker();
    const branchName = await branchLinker.getBranchForIssue(issueNumber);

    if (!branchName) {
        return null;
    }

    return getWorktreeForBranch(branchName);
}

/**
 * Open a worktree in a new VS Code window
 */
export async function openWorktreeInNewWindow(worktreePath: string): Promise<void> {
    const uri = vscode.Uri.file(worktreePath);
    await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
}

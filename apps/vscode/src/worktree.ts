import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, copyFileSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { GitHubAPI } from './github-api';
import {
    generateBranchName,
    branchExists,
    createBranch,
    checkoutBranch,
    // Use core worktree functions with validation
    createWorktree as coreCreateWorktree,
    listWorktrees,
    getWorktreeForBranch,
} from './git-utils';
import type { WorktreeInfo } from './git-utils';
import type { NormalizedProjectItem, ProjectWithViews } from './types';
import { getBranchLinker } from './extension';

const execAsync = promisify(exec);

/**
 * Spawn context written to worktree for the new window to pick up
 */
export interface SpawnContext {
    action: 'spawn_subagent';
    issue: {
        number: number;
        title: string;
        status: string | null;
        url: string;
    };
    branch: string;
    repository: {
        owner: string;
        name: string;
    };
    createdAt: string;
}

const SPAWN_CONTEXT_FILE = '.ghp/spawn-context.json';

/**
 * Write spawn context to worktree for the new window to detect
 */
export function writeSpawnContext(worktreePath: string, context: SpawnContext): void {
    const ghpDir = join(worktreePath, '.ghp');
    if (!existsSync(ghpDir)) {
        mkdirSync(ghpDir, { recursive: true });
    }
    writeFileSync(join(worktreePath, SPAWN_CONTEXT_FILE), JSON.stringify(context, null, 2));
}

/**
 * Read spawn context from current workspace
 */
export function readSpawnContext(workspacePath: string): SpawnContext | null {
    const contextPath = join(workspacePath, SPAWN_CONTEXT_FILE);
    if (!existsSync(contextPath)) {
        return null;
    }
    try {
        return JSON.parse(readFileSync(contextPath, 'utf-8'));
    } catch {
        return null;
    }
}

/**
 * Remove spawn context after it's been consumed
 */
export function removeSpawnContext(workspacePath: string): void {
    const contextPath = join(workspacePath, SPAWN_CONTEXT_FILE);
    if (existsSync(contextPath)) {
        try {
            unlinkSync(contextPath);
        } catch {
            // Ignore errors
        }
    }
}

/**
 * Convert a directory path to Claude's project directory name format.
 * Claude encodes paths like /home/user/project as -home-user-project
 */
function pathToClaudeProjectName(dirPath: string): string {
    return dirPath.replace(/\//g, '-');
}

/**
 * Check if there are previous Claude sessions for a given directory.
 * Returns the count of session files found.
 */
export function detectClaudeSessions(worktreePath: string): number {
    const claudeDir = join(homedir(), '.claude', 'projects');
    const projectName = pathToClaudeProjectName(worktreePath);
    const projectDir = join(claudeDir, projectName);

    try {
        const files = readdirSync(projectDir);
        // Count .jsonl files (session transcripts)
        const sessions = files.filter(f => f.endsWith('.jsonl'));
        return sessions.length;
    } catch {
        // Directory doesn't exist or can't be read
        return 0;
    }
}

/**
 * Get Claude command configuration
 */
export function getClaudeConfig(): { autoRun: boolean; autoResume: boolean; command: string } {
    const config = vscode.workspace.getConfiguration('ghProjects');
    return {
        autoRun: config.get<boolean>('parallelWork.autoRunClaude', true),
        autoResume: config.get<boolean>('parallelWork.autoResume', true),
        command: config.get<string>('parallelWork.claudeCommand', 'ghp-start'),
    };
}

/**
 * Build the Claude command to run in terminal
 */
export function buildClaudeCommand(
    issueNumber: number,
    issueTitle: string,
    claudeCommand: string,
    resumeSession: boolean = false
): string {
    if (resumeSession) {
        return 'claude --resume';
    }

    if (claudeCommand) {
        return `claude "/${claudeCommand} ${issueNumber}"`;
    }

    // Fallback: claude with issue context as initial message
    const escapedTitle = issueTitle.replace(/"/g, '\\"').replace(/'/g, "\\'");
    return `ghp open ${issueNumber} && claude "I'm working on issue #${issueNumber}: ${escapedTitle}. Please help me implement this."`;
}

/**
 * Known Claude extension IDs to check for
 */
const CLAUDE_EXTENSION_IDS = [
    'anthropics.claude-code',        // Official Claude Code extension
    'anthropic.claude-dev',          // Alternative ID
    'saoudrizwan.claude-dev',        // Community extension
];

/**
 * Check if Claude Code extension is installed and get it
 */
function getClaudeExtension(): vscode.Extension<unknown> | undefined {
    for (const extId of CLAUDE_EXTENSION_IDS) {
        const ext = vscode.extensions.getExtension(extId);
        if (ext) {
            return ext;
        }
    }
    return undefined;
}

/**
 * Try to start Claude via the extension's command
 * Returns true if successful, false if should fall back to terminal
 */
async function tryClaudeExtension(context: SpawnContext, resumeSession: boolean): Promise<boolean> {
    const claudeExt = getClaudeExtension();
    if (!claudeExt) {
        return false;
    }

    // Ensure the extension is activated
    if (!claudeExt.isActive) {
        try {
            await claudeExt.activate();
        } catch {
            return false;
        }
    }

    // Try known commands for starting Claude
    const commands = [
        'claude-code.startSession',
        'claude-dev.openInNewTab',
        'claude.newChat',
    ];

    // Get available commands
    const allCommands = await vscode.commands.getCommands();

    for (const cmd of commands) {
        if (allCommands.includes(cmd)) {
            try {
                // Build initial prompt
                const prompt = resumeSession
                    ? undefined // Let extension handle resume
                    : `I'm working on issue #${context.issue.number}: ${context.issue.title}. Please help me implement this.`;

                await vscode.commands.executeCommand(cmd, { prompt });
                return true;
            } catch {
                // Command failed, try next
            }
        }
    }

    return false;
}

/**
 * Open Claude for the spawn context - tries extension first, falls back to terminal
 */
export async function openClaudeTerminal(context: SpawnContext, workspacePath: string): Promise<void> {
    const claudeConfig = getClaudeConfig();

    // Check for existing sessions
    let resumeSession = false;
    if (claudeConfig.autoResume) {
        const sessionCount = detectClaudeSessions(workspacePath);
        if (sessionCount > 0) {
            resumeSession = true;
            vscode.window.showInformationMessage(
                `Found ${sessionCount} previous Claude session(s) - opening resume picker`
            );
        }
    }

    // Try Claude extension first
    const usedExtension = await tryClaudeExtension(context, resumeSession);
    if (usedExtension) {
        return;
    }

    // Fall back to terminal
    const command = buildClaudeCommand(
        context.issue.number,
        context.issue.title,
        claudeConfig.command,
        resumeSession
    );

    // Create and show terminal
    const terminal = vscode.window.createTerminal({
        name: `Claude: #${context.issue.number}`,
        cwd: workspacePath,
        env: {
            GHP_SPAWN_CONTEXT: JSON.stringify(context),
        },
    });

    terminal.show();
    terminal.sendText(command);
}

/**
 * Check for spawn context on extension activation and offer to start Claude
 */
export async function checkForSpawnContext(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return;
    }

    const workspacePath = workspaceFolders[0].uri.fsPath;
    const context = readSpawnContext(workspacePath);

    if (!context) {
        return;
    }

    // Check if context is recent (within last 5 minutes)
    const createdAt = new Date(context.createdAt);
    const now = new Date();
    const ageMinutes = (now.getTime() - createdAt.getTime()) / 1000 / 60;

    if (ageMinutes > 5) {
        // Context is stale, remove it
        removeSpawnContext(workspacePath);
        return;
    }

    const claudeConfig = getClaudeConfig();

    if (claudeConfig.autoRun) {
        // Auto-start Claude
        await openClaudeTerminal(context, workspacePath);
        removeSpawnContext(workspacePath);
    } else {
        // Ask user
        const action = await vscode.window.showInformationMessage(
            `This workspace was created for issue #${context.issue.number}: ${context.issue.title}. Start Claude?`,
            'Start Claude',
            'Dismiss'
        );

        if (action === 'Start Claude') {
            await openClaudeTerminal(context, workspacePath);
        }

        removeSpawnContext(workspacePath);
    }
}

// Re-export WorktreeInfo for consumers
export type { WorktreeInfo } from './git-utils';
// Re-export worktree query functions
export { listWorktrees, getWorktreeForBranch } from './git-utils';

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

    // Create the worktree (uses core function with input validation)
    await coreCreateWorktree(worktreePath, branchName);

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

    // Write spawn context for the new window to pick up
    if (item.number && item.repository) {
        const [owner, repoNamePart] = item.repository.split('/');
        const spawnContext: SpawnContext = {
            action: 'spawn_subagent',
            issue: {
                number: item.number,
                title: item.title,
                status: item.status || null,
                url: item.url || `https://github.com/${item.repository}/issues/${item.number}`,
            },
            branch: branchName,
            repository: {
                owner,
                name: repoNamePart,
            },
            createdAt: new Date().toISOString(),
        };
        writeSpawnContext(worktreePath, spawnContext);
    }

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

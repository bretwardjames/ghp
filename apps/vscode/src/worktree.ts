import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, copyFileSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { GitHubAPI } from './github-api';
import {
    generateBranchName,
    branchExists,
    createBranch,
    checkoutBranch,
    sanitizeForBranchName,
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
 * Persistent worktree configuration stored in .ghp/worktree.json
 * This file persists across window reopens to identify GHP worktrees
 */
export interface WorktreeContext {
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
    /** Set to true after user dismisses the "Start Claude?" prompt */
    claudePromptDismissed?: boolean;
    /** Set to true when this is a fresh worktree (not yet opened) */
    isNew?: boolean;
}

const WORKTREE_CONFIG_FILE = '.ghp/worktree.json';

/**
 * Write worktree context (persistent, not deleted after use)
 */
export function writeWorktreeContext(worktreePath: string, context: WorktreeContext): void {
    const ghpDir = join(worktreePath, '.ghp');
    if (!existsSync(ghpDir)) {
        mkdirSync(ghpDir, { recursive: true });
    }
    writeFileSync(join(worktreePath, WORKTREE_CONFIG_FILE), JSON.stringify(context, null, 2));
}

/**
 * Read worktree context from workspace
 */
export function readWorktreeContext(workspacePath: string): WorktreeContext | null {
    const contextPath = join(workspacePath, WORKTREE_CONFIG_FILE);
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
 * Update worktree context (preserves existing fields)
 */
export function updateWorktreeContext(workspacePath: string, updates: Partial<WorktreeContext>): void {
    const existing = readWorktreeContext(workspacePath);
    if (existing) {
        writeWorktreeContext(workspacePath, { ...existing, ...updates });
    }
}

/**
 * Check if this workspace is a GHP worktree
 */
export function isGhpWorktree(workspacePath: string): boolean {
    return existsSync(join(workspacePath, WORKTREE_CONFIG_FILE));
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
 * Escape a string for safe use in shell commands using single quotes.
 * This is the safest method as single quotes prevent all shell interpretation
 * except for the single quote character itself.
 */
function shellEscape(str: string): string {
    // Wrap in single quotes and escape any embedded single quotes
    // 'foo'bar' -> 'foo'\''bar'
    return "'" + str.replace(/'/g, "'\\''") + "'";
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
    // Use proper shell escaping to prevent command injection
    const prompt = `I'm working on issue #${issueNumber}: ${issueTitle}. Please help me implement this.`;
    return `ghp open ${issueNumber} && claude ${shellEscape(prompt)}`;
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
async function tryClaudeExtension(context: WorktreeContext, resumeSession: boolean): Promise<boolean> {
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
 * Open Claude for the worktree context - tries extension first, falls back to terminal
 */
export async function openClaudeTerminal(context: WorktreeContext, workspacePath: string): Promise<void> {
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

    // Serialize context for environment variable (with defensive error handling)
    let contextJson: string;
    try {
        contextJson = JSON.stringify(context);
    } catch (err) {
        console.error('Failed to serialize worktree context:', err);
        contextJson = '{}';
    }

    // Create and show terminal
    const terminal = vscode.window.createTerminal({
        name: `Claude: #${context.issue.number}`,
        cwd: workspacePath,
        env: {
            GHP_SPAWN_CONTEXT: contextJson,
        },
    });

    terminal.show();
    terminal.sendText(command);
}

/**
 * Check for worktree context on extension activation and offer to start Claude.
 * Works for both new worktrees and reopened existing worktrees.
 */
export async function checkForWorktreeContext(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return;
    }

    const workspacePath = workspaceFolders[0].uri.fsPath;
    const context = readWorktreeContext(workspacePath);

    if (!context) {
        return;
    }

    // If user previously dismissed the prompt, don't ask again
    if (context.claudePromptDismissed) {
        return;
    }

    const claudeConfig = getClaudeConfig();
    const isNewWorktree = context.isNew === true;

    // For new worktrees with autoRun, start Claude immediately
    if (isNewWorktree && claudeConfig.autoRun) {
        await openClaudeTerminal(context, workspacePath);
        // Mark as no longer new
        updateWorktreeContext(workspacePath, { isNew: false });
        return;
    }

    // For reopened worktrees or when autoRun is disabled, ask the user
    const sessionCount = detectClaudeSessions(workspacePath);
    const hasExistingSessions = sessionCount > 0;

    const message = hasExistingSessions
        ? `GHP Worktree: #${context.issue.number} - ${context.issue.title} (${sessionCount} previous session${sessionCount > 1 ? 's' : ''})`
        : `GHP Worktree: #${context.issue.number} - ${context.issue.title}`;

    const startLabel = hasExistingSessions ? 'Resume Claude' : 'Start Claude';

    const action = await vscode.window.showInformationMessage(
        message,
        startLabel,
        "Don't Ask Again",
        'Dismiss'
    );

    if (action === startLabel) {
        await openClaudeTerminal(context, workspacePath);
        // Mark as no longer new
        if (isNewWorktree) {
            updateWorktreeContext(workspacePath, { isNew: false });
        }
    } else if (action === "Don't Ask Again") {
        updateWorktreeContext(workspacePath, { claudePromptDismissed: true, isNew: false });
    } else {
        // Dismiss - just mark as not new so we ask again next time
        if (isNewWorktree) {
            updateWorktreeContext(workspacePath, { isNew: false });
        }
    }
}

/**
 * Manually start Claude in the current worktree (command handler)
 */
export async function startClaudeInWorktree(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('No workspace folder open');
        return;
    }

    const workspacePath = workspaceFolders[0].uri.fsPath;
    const context = readWorktreeContext(workspacePath);

    if (!context) {
        vscode.window.showWarningMessage('This is not a GHP worktree');
        return;
    }

    // Reset the dismissed flag since user explicitly wants Claude
    if (context.claudePromptDismissed) {
        updateWorktreeContext(workspacePath, { claudePromptDismissed: false });
    }

    await openClaudeTerminal(context, workspacePath);
}

/**
 * Get the current worktree context (for status bar, etc.)
 */
export function getCurrentWorktreeContext(): WorktreeContext | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return null;
    }
    return readWorktreeContext(workspaceFolders[0].uri.fsPath);
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
 * Create a slug from a title (for directory names).
 * Uses sanitizeForBranchName from core for consistency across CLI and VS Code.
 */
function slugify(text: string, maxLength: number = 40): string {
    return sanitizeForBranchName(text).slice(0, maxLength).replace(/-+$/, '');
}

/**
 * Generate a worktree path for an issue.
 * Format: {basePath}/{repoName}/{number}-{title-slug}
 * Example: ~/.ghp/worktrees/care/271-macos-stat-fallback
 */
export function generateWorktreePath(
    basePath: string,
    repoName: string,
    issueNumber: number | undefined,
    issueTitle: string
): string {
    const expandedBase = expandPath(basePath);

    // Build directory name: {number}-{title-slug} or just {title-slug}
    let dirName: string;
    if (issueNumber) {
        const titleSlug = slugify(issueTitle, 35); // Leave room for number
        dirName = `${issueNumber}-${titleSlug}`;
    } else {
        dirName = slugify(issueTitle, 50);
    }

    return join(expandedBase, repoName, dirName);
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

    // Generate worktree path with descriptive name
    const worktreePath = generateWorktreePath(wtConfig.path, repoName, item.number, item.title);

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

    // Write worktree context for the new window to pick up
    if (item.number && item.repository) {
        const [owner, repoNamePart] = item.repository.split('/');
        const worktreeContext: WorktreeContext = {
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
            isNew: true, // Mark as new so auto-run works
        };
        writeWorktreeContext(worktreePath, worktreeContext);
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

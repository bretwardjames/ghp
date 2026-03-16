import { exec, execFile, execSync, spawn } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { getConfig, getParallelWorkConfig, type TerminalMode, type ResolvedDashboardConfig } from './config.js';
import type { SubagentSpawnDirective } from './types.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

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
export async function detectClaudeSessions(worktreePath: string): Promise<number> {
    const claudeDir = path.join(os.homedir(), '.claude', 'projects');
    const projectName = pathToClaudeProjectName(worktreePath);
    const projectDir = path.join(claudeDir, projectName);

    try {
        const files = await fs.promises.readdir(projectDir);
        // Count .jsonl files (session transcripts)
        const sessions = files.filter(f => f.endsWith('.jsonl'));
        return sessions.length;
    } catch {
        // Directory doesn't exist or can't be read
        return 0;
    }
}

/**
 * Terminal emulator configuration
 */
export interface TerminalConfig {
    /** The terminal command to use (e.g., 'gnome-terminal', 'iTerm.app') */
    command?: string;
    /** Whether to auto-detect the terminal if not specified */
    autoDetect?: boolean;
}

/**
 * Known terminal emulators by platform
 */
/**
 * Check if we're running inside a tmux session
 */
export function isInsideTmux(): boolean {
    return !!process.env.TMUX;
}

/**
 * Tmux configuration for spawning
 */
interface TmuxConfig {
    mode: 'window' | 'pane' | 'session';
    paneDirection?: 'horizontal' | 'vertical';
    prefix: string;
}

/**
 * Get tmux configuration from config
 */
function getTmuxConfig(): TmuxConfig {
    const config = getConfig('parallelWork');
    return {
        mode: config?.tmux?.mode ?? 'window',
        paneDirection: config?.tmux?.paneDirection ?? 'horizontal',
        prefix: config?.tmux?.prefix ?? 'ghp',
    };
}

// ---------------------------------------------------------------------------
// Tmux naming helpers — all tmux names derive from the configured prefix
// ---------------------------------------------------------------------------

/**
 * Get the configured tmux prefix (default: 'ghp').
 */
export function getTmuxPrefix(): string {
    const config = getConfig('parallelWork');
    return config?.tmux?.prefix ?? 'ghp';
}

/**
 * Generate a tmux window name for an agent (e.g., 'ghp-86' or 'myproj-86').
 */
export function agentWindowName(issueNumber: number): string {
    return `${getTmuxPrefix()}-${issueNumber}`;
}

/**
 * Generate a tmux session name for an agent in session mode (e.g., 'ghp-agent-86').
 */
export function agentSessionName(issueNumber: number): string {
    return `${getTmuxPrefix()}-agent-${issueNumber}`;
}

/**
 * Generate the tmux admin/dashboard window name (e.g., 'ghp-admin').
 */
export function adminWindowName(): string {
    return `${getTmuxPrefix()}-admin`;
}

// ---------------------------------------------------------------------------
// Tmux session utilities (for session mode)
// ---------------------------------------------------------------------------

/**
 * Create a new tmux session for an agent (session mode).
 * The session runs detached with status bar off for a clean nested experience.
 */
export async function openTmuxSession(
    directory: string,
    sessionName: string,
    command?: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        const args = [
            'new-session', '-d',
            '-s', sessionName,
            '-c', directory,
        ];
        if (command) {
            args.push(command);
        }
        await execFileAsync('tmux', args);

        // Turn off the status bar inside the agent session for a clean nested look
        try {
            await execFileAsync('tmux', ['set-option', '-t', `=${sessionName}`, 'status', 'off']);
        } catch { /* best effort */ }

        return { success: true };
    } catch (err) {
        return {
            success: false,
            error: `Failed to create tmux session "${sessionName}": ${err instanceof Error ? err.message : 'unknown'}`,
        };
    }
}

/**
 * Kill a tmux session by name.
 */
export async function killTmuxSession(sessionName: string): Promise<{ success: boolean; error?: string }> {
    try {
        await execFileAsync('tmux', ['kill-session', '-t', `=${sessionName}`]);
        return { success: true };
    } catch {
        return { success: false, error: `Session "${sessionName}" not found or tmux not available` };
    }
}

/**
 * Check if a tmux session exists.
 */
export async function tmuxSessionExists(sessionName: string): Promise<boolean> {
    try {
        await execFileAsync('tmux', ['has-session', '-t', `=${sessionName}`]);
        return true;
    } catch {
        return false;
    }
}

/**
 * Open a new tmux window or pane at the specified directory
 * @param directory - Working directory for the new window/pane
 * @param command - Optional command to run
 * @param windowName - Optional window name (for tracking/killing later)
 */
export async function openTmuxTerminal(
    directory: string,
    command?: string,
    windowName?: string,
    options?: { background?: boolean; issueNumber?: number }
): Promise<{ success: boolean; error?: string }> {
    const tmuxConfig = getTmuxConfig();
    const bg = options?.background ?? false;

    // Session mode: create a detached tmux session instead of a window/pane
    if (tmuxConfig.mode === 'session' && windowName) {
        const sessionName = options?.issueNumber != null
            ? agentSessionName(options.issueNumber)
            : `${tmuxConfig.prefix}-agent-${windowName}`;
        return openTmuxSession(directory, sessionName, command);
    }

    return new Promise((resolve) => {
        let tmuxArgs: string[];

        if (tmuxConfig.mode === 'pane') {
            // Split current window into a new pane
            const splitFlag = tmuxConfig.paneDirection === 'vertical' ? '-v' : '-h';
            const baseArgs = ['split-window', splitFlag, ...(bg ? ['-d'] : []), '-c', directory];
            tmuxArgs = command ? [...baseArgs, command] : baseArgs;
        } else {
            // Create a new window (default) with optional name
            const baseArgs = ['new-window', ...(bg ? ['-d'] : []), ...(windowName ? ['-n', windowName] : []), '-c', directory];
            tmuxArgs = command ? [...baseArgs, command] : baseArgs;
        }

        const child = spawn('tmux', tmuxArgs, {
            stdio: 'ignore',
        });

        child.on('error', (err) => {
            resolve({
                success: false,
                error: `Failed to open tmux ${tmuxConfig.mode}: ${err.message}`,
            });
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve({ success: true });
            } else {
                resolve({
                    success: false,
                    error: `tmux exited with code ${code}`,
                });
            }
        });
    });
}

/**
 * Kill a tmux window by name.
 *
 * Handles renamed windows (e.g., the pipeline registry renames "ghp-86" to
 * "📋 ghp-86"). Searches across ALL tmux sessions for a window whose name
 * contains the given base name.
 *
 * Works even when the caller is not inside tmux — tmux just needs to be
 * running on the system.
 *
 * @param windowName - The base name of the window to kill (e.g., "ghp-39")
 */
export async function killTmuxWindow(windowName: string): Promise<{ success: boolean; error?: string }> {
    try {
        // List all windows across all sessions. Format: "session:index\twindow_name"
        const { stdout } = await execAsync(
            `tmux list-windows -a -F '#{session_name}:#{window_index}\t#{window_name}' 2>/dev/null`
        );

        // Find windows whose name contains the base window name (handles emoji prefixes)
        const matches = stdout
            .trim()
            .split('\n')
            .filter((line) => {
                const name = line.split('\t')[1];
                return name && name.includes(windowName);
            });

        if (matches.length === 0) {
            return { success: false, error: `Window "${windowName}" not found` };
        }

        // Kill all matching windows (there could be duplicates from re-starts)
        for (const match of matches) {
            const target = match.split('\t')[0]; // "session:index"
            try {
                await execAsync(`tmux kill-window -t '${target}'`);
            } catch {
                // Window may have already been killed
            }
        }

        return { success: true };
    } catch {
        // tmux not running or not installed
        return { success: false, error: 'tmux not available' };
    }
}

const TERMINALS: Record<string, Array<{ command: string; args: (dir: string, cmd?: string) => string[] }>> = {
    linux: [
        { command: 'ghostty', args: (dir, cmd) => cmd ? ['--working-directory', dir, '-e', cmd] : ['--working-directory', dir] },
        { command: 'foot', args: (dir, cmd) => cmd ? ['--working-directory', dir, 'bash', '-c', cmd] : ['--working-directory', dir] },
        { command: 'gnome-terminal', args: (dir, cmd) => cmd ? ['--working-directory', dir, '--', 'bash', '-c', cmd] : ['--working-directory', dir] },
        { command: 'konsole', args: (dir, cmd) => cmd ? ['--workdir', dir, '-e', cmd] : ['--workdir', dir] },
        { command: 'xfce4-terminal', args: (dir, cmd) => cmd ? ['--working-directory', dir, '-e', cmd] : ['--working-directory', dir] },
        { command: 'alacritty', args: (dir, cmd) => cmd ? ['--working-directory', dir, '-e', 'bash', '-c', cmd] : ['--working-directory', dir] },
        { command: 'kitty', args: (dir, cmd) => cmd ? ['--directory', dir, 'bash', '-c', cmd] : ['--directory', dir] },
        { command: 'wezterm', args: (dir, cmd) => cmd ? ['start', '--cwd', dir, '--', 'bash', '-c', cmd] : ['start', '--cwd', dir] },
        { command: 'xterm', args: (dir, cmd) => cmd ? ['-e', `cd "${dir}" && ${cmd}`] : ['-e', `cd "${dir}" && bash`] },
        { command: 'x-terminal-emulator', args: (dir, cmd) => cmd ? ['-e', `cd "${dir}" && ${cmd}`] : ['-e', `cd "${dir}" && bash`] },
    ],
    darwin: [
        { command: 'open', args: (dir, cmd) => {
            // macOS uses AppleScript for Terminal.app
            // For iTerm, we'd need different handling
            if (cmd) {
                return ['-a', 'Terminal', dir, '--args', '-e', cmd];
            }
            return ['-a', 'Terminal', dir];
        }},
    ],
    win32: [
        { command: 'wt', args: (dir, cmd) => cmd ? ['-d', dir, 'cmd', '/c', cmd] : ['-d', dir] }, // Windows Terminal
        { command: 'cmd', args: (dir, cmd) => cmd ? ['/c', `start cmd /k "cd /d "${dir}" && ${cmd}"`] : ['/c', `start cmd /k "cd /d "${dir}"`] },
    ],
};

/**
 * Check if a command exists in PATH
 */
async function commandExists(command: string): Promise<boolean> {
    try {
        const which = os.platform() === 'win32' ? 'where' : 'which';
        await execAsync(`${which} ${command}`);
        return true;
    } catch {
        return false;
    }
}

/**
 * Detect the best available terminal emulator for the current platform
 */
export async function detectTerminal(): Promise<{ command: string; args: (dir: string, cmd?: string) => string[] } | null> {
    const platform = os.platform();
    const terminals = TERMINALS[platform] || [];

    // Check config for user preference first
    const configuredTerminal = getConfig('parallelWork')?.terminal;
    if (configuredTerminal) {
        const found = terminals.find(t => t.command === configuredTerminal);
        if (found && await commandExists(found.command)) {
            return found;
        }
        // User specified a terminal but it's not in our list or not found
        // Try to use it anyway with generic args
        if (await commandExists(configuredTerminal)) {
            return {
                command: configuredTerminal,
                args: (dir, cmd) => cmd ? ['-e', `cd "${dir}" && ${cmd}`] : ['-e', `cd "${dir}" && bash`],
            };
        }
        console.log(chalk.yellow('Warning:'), `Configured terminal "${configuredTerminal}" not found, auto-detecting...`);
    }

    // Auto-detect
    for (const terminal of terminals) {
        if (await commandExists(terminal.command)) {
            return terminal;
        }
    }

    return null;
}

/**
 * Build the command to run in the new terminal.
 * If resumeSession is true, uses `claude --resume` to offer session picker.
 */
export function buildClaudeCommand(
    issueNumber: number,
    issueTitle: string,
    worktreePath: string,
    claudeCommand: string | null,
    resumeSession: boolean = false
): string {
    if (resumeSession) {
        // Use --resume to open the interactive session picker
        // This lets the user choose which previous session to continue
        return `claude --resume`;
    }

    if (claudeCommand) {
        // Use the configured slash command
        return `claude "/${claudeCommand} ${issueNumber}"`;
    }

    // Fallback: claude with issue context as initial message
    // We use ghp open to show the issue first, then start claude
    const escapedTitle = issueTitle.replace(/"/g, '\\"').replace(/'/g, "\\'");
    return `ghp open ${issueNumber} && echo "" && claude "I'm working on issue #${issueNumber}: ${escapedTitle}. Please help me implement this."`;
}

/**
 * Get the Claude command to use, checking if it exists
 * Returns the command name if found, null otherwise
 */
export async function getClaudeCommand(): Promise<string | null> {
    const config = getParallelWorkConfig();
    const commandName = config.claudeCommand ?? 'ghp-start';

    // Empty string means explicitly use fallback
    if (commandName === '') {
        return null;
    }

    // Check for .claude/commands/{commandName}.md in the worktree or home directory
    const homeDir = os.homedir();
    const possiblePaths = [
        path.join(homeDir, '.claude', 'commands', `${commandName}.md`),
        path.join(process.cwd(), '.claude', 'commands', `${commandName}.md`),
    ];

    for (const p of possiblePaths) {
        try {
            await fs.promises.access(p, fs.constants.F_OK);
            return commandName;
        } catch {
            // File doesn't exist, try next
        }
    }

    return null;
}

/**
 * Check if a start command exists (workspace or global)
 * Returns the command name if found, null otherwise
 */
async function findStartCommand(worktreePath: string): Promise<string | null> {
    const homeDir = os.homedir();

    // Check workspace first, then global
    const possiblePaths = [
        path.join(worktreePath, '.claude', 'commands', 'start.md'),
        path.join(homeDir, '.claude', 'commands', 'start.md'),
    ];

    for (const p of possiblePaths) {
        try {
            await fs.promises.access(p, fs.constants.F_OK);
            return 'start';
        } catch {
            // File doesn't exist, try next
        }
    }

    return null;
}

/**
 * Build the command to run neovim with coder/claudecode.nvim plugin.
 * Uses ClaudeCode to open the plugin, then ClaudeCodeSend to send /start command.
 */
export async function buildNvimClaudeCommand(
    worktreePath: string,
    nvimCommand: string,
    _resumeSession: boolean = false
): Promise<string> {
    // Check if start command exists
    const startCmd = await findStartCommand(worktreePath);

    if (startCmd) {
        // Open nvim, toggle Claude, send /start command
        // /start auto-detects issue from branch and handles both new and resume cases
        return `${nvimCommand} -c "ClaudeCode" -c "sleep 500m" -c "ClaudeCodeSend /start"`;
    }

    // No start command found, just open Claude
    return `${nvimCommand} -c "ClaudeCode"`;
}

/**
 * Open a new terminal window at the specified directory and optionally run a command.
 * If running inside tmux and configured to use it, spawns a tmux window/pane instead.
 * @param directory - Working directory for the new terminal
 * @param command - Optional command to run
 * @param windowName - Optional window name for tmux (e.g., "ghp-39")
 */
export async function openTerminal(
    directory: string,
    command?: string,
    windowName?: string,
    options?: { background?: boolean; issueNumber?: number }
): Promise<{ success: boolean; error?: string }> {
    // Check if we should use tmux
    const parallelConfig = getConfig('parallelWork');
    const preferTmux = parallelConfig?.terminal === 'tmux';
    const inTmux = isInsideTmux();

    // Use tmux if: explicitly configured OR (inside tmux and not configured otherwise)
    if (preferTmux || (inTmux && !parallelConfig?.terminal)) {
        if (!inTmux) {
            return {
                success: false,
                error: 'Configured to use tmux but not running inside a tmux session.',
            };
        }
        console.log(chalk.dim('Using tmux for parallel terminal...'));
        return openTmuxTerminal(directory, command, windowName, options);
    }

    const terminal = await detectTerminal();

    if (!terminal) {
        return {
            success: false,
            error: 'No terminal emulator found. Set one in config with: ghp config parallelWork.terminal <terminal>',
        };
    }

    const args = terminal.args(directory, command);

    return new Promise((resolve) => {
        const child = spawn(terminal.command, args, {
            detached: true,
            stdio: 'ignore',
        });

        child.on('error', (err) => {
            resolve({
                success: false,
                error: `Failed to open terminal: ${err.message}`,
            });
        });

        // Detach the child process so it runs independently
        child.unref();

        // Give it a moment to start, then assume success
        setTimeout(() => {
            resolve({ success: true });
        }, 500);
    });
}

/**
 * Open a terminal for parallel work on an issue.
 * If autoResume is enabled and previous sessions exist, offers to resume.
 */
export async function openParallelWorkTerminal(
    worktreePath: string,
    issueNumber: number,
    issueTitle: string,
    spawnDirective: SubagentSpawnDirective,
    modeOverride?: TerminalMode,
    options?: { background?: boolean }
): Promise<{ success: boolean; error?: string; resumed?: boolean }> {
    const config = getParallelWorkConfig();
    const terminalMode = modeOverride ?? config.terminalMode;

    // Terminal-only mode: just open the terminal, no Claude
    if (terminalMode === 'terminal') {
        const windowName = agentWindowName(issueNumber);
        const result = await openTerminal(worktreePath, undefined, windowName, { ...options, issueNumber });
        return { ...result, resumed: false };
    }

    // Check if we should try to resume a previous session
    let shouldResume = false;
    if (config.autoResume) {
        const sessionCount = await detectClaudeSessions(worktreePath);
        if (sessionCount > 0) {
            shouldResume = true;
            console.log(chalk.cyan('ℹ'), `Found ${sessionCount} previous Claude session(s) - opening resume picker`);
        }
    }

    // Build the command based on terminal mode
    let command: string;
    if (terminalMode === 'nvim-claude') {
        command = await buildNvimClaudeCommand(worktreePath, config.nvimCommand, shouldResume);
    } else {
        // Default: claude mode
        const claudeCommand = await getClaudeCommand();
        command = buildClaudeCommand(issueNumber, issueTitle, worktreePath, claudeCommand, shouldResume);
    }

    // Set the spawn context as an environment variable for Claude to potentially use
    const envJson = JSON.stringify(spawnDirective);
    const fullCommand = `export GHP_SPAWN_CONTEXT='${envJson.replace(/'/g, "'\\''")}' && ${command}`;

    // Name the tmux window with the issue number for tracking/cleanup
    const windowName = agentWindowName(issueNumber);
    const result = await openTerminal(worktreePath, fullCommand, windowName, { ...options, issueNumber });
    return { ...result, resumed: shouldResume };
}

/**
 * Check if the pipeline dashboard is already open (as a pane or window).
 */
export async function isDashboardOpen(): Promise<boolean> {
    if (!isInsideTmux()) return false;

    const adminName = adminWindowName();
    return new Promise((resolve) => {
        // Check both panes (for pane mode) and windows (for window mode)
        const child = spawn('tmux', ['list-panes', '-a', '-F', '#{pane_current_command} #{window_name}'], {
            stdio: ['ignore', 'pipe', 'ignore'],
        });

        let output = '';
        child.stdout.on('data', (data) => {
            output += data.toString();
        });

        child.on('close', () => {
            const lines = output.split('\n');
            resolve(lines.some(l => l.includes(adminName)));
        });
    });
}

/**
 * Capture the current pane ID. Call this BEFORE spawning agent windows
 * so openAdminPane can target the correct window even after focus has moved.
 */
export function captureOriginPane(): string | null {
    if (!process.env.TMUX) return null;
    try {
        const { execFileSync } = require('child_process');
        return (execFileSync('tmux', ['display-message', '-p', '#{pane_id}']) as Buffer)
            .toString().trim() || null;
    } catch {
        return null;
    }
}

/**
 * Open the pipeline dashboard as a split pane or new window, based on config.
 * Always splits the caller's window (or creates new window), never the agent window.
 *
 * Reads dashboard config from `parallelWork.dashboard`:
 * - mode: 'pane' (split current window) or 'window' (new tmux window)
 * - direction: 'horizontal' or 'vertical' (for pane mode)
 * - size: pane/window size (e.g., '50%')
 *
 * After opening, fires `.ghp/hooks/dashboard-opened` user hook.
 */
export async function openAdminPane(targetPaneId?: string | null): Promise<{ success: boolean; alreadyOpen?: boolean; error?: string }> {
    if (!isInsideTmux()) {
        return { success: false, error: 'Not inside tmux session' };
    }

    if (await isDashboardOpen()) {
        return { success: true, alreadyOpen: true };
    }

    const dashboardConfig = getParallelWorkConfig().dashboard;
    const command = 'ghp pipeline dashboard';

    return new Promise((resolve) => {
        let tmuxArgs: string[];

        if (dashboardConfig.mode === 'window') {
            // Open dashboard in a new tmux window
            tmuxArgs = ['new-window', '-d', '-n', adminWindowName(), command];
        } else {
            // Open dashboard as a split pane
            const dirFlag = dashboardConfig.direction === 'vertical' ? '-v' : '-h';
            tmuxArgs = targetPaneId
                ? ['split-window', dirFlag, '-d', '-l', dashboardConfig.size, '-t', targetPaneId, command]
                : ['split-window', dirFlag, '-d', '-l', dashboardConfig.size, command];
        }

        const child = spawn('tmux', tmuxArgs, {
            stdio: 'ignore',
        });

        child.on('error', (err) => {
            resolve({ success: false, error: `Failed to open dashboard: ${err.message}` });
        });

        child.on('close', (code) => {
            if (code === 0) {
                // Hook is fired by ghp pipeline dashboard itself (dashboard-pipeline.ts)
                // since it has direct access to its own TMUX_PANE.
                resolve({ success: true });
            } else {
                resolve({ success: false, error: `tmux exited with code ${code}` });
            }
        });
    });
}

/**
 * Get a list of available terminal emulators on the current platform
 */
export async function listAvailableTerminals(): Promise<string[]> {
    const platform = os.platform();
    const terminals = TERMINALS[platform] || [];
    const available: string[] = [];

    // Include tmux if we're inside a tmux session
    if (isInsideTmux()) {
        available.push('tmux');
    }

    for (const terminal of terminals) {
        if (await commandExists(terminal.command)) {
            available.push(terminal.command);
        }
    }

    return available;
}

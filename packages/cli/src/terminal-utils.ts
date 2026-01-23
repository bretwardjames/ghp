import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { getConfig, getParallelWorkConfig } from './config.js';
import type { SubagentSpawnDirective } from './types.js';

const execAsync = promisify(exec);

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
    mode: 'window' | 'pane';
    paneDirection?: 'horizontal' | 'vertical';
}

/**
 * Get tmux configuration from config
 */
function getTmuxConfig(): TmuxConfig {
    const config = getConfig('parallelWork');
    return {
        mode: config?.tmux?.mode ?? 'window',
        paneDirection: config?.tmux?.paneDirection ?? 'horizontal',
    };
}

/**
 * Open a new tmux window or pane at the specified directory
 */
export async function openTmuxTerminal(
    directory: string,
    command?: string
): Promise<{ success: boolean; error?: string }> {
    const tmuxConfig = getTmuxConfig();

    return new Promise((resolve) => {
        let tmuxArgs: string[];

        if (tmuxConfig.mode === 'pane') {
            // Split current window into a new pane
            const splitFlag = tmuxConfig.paneDirection === 'vertical' ? '-v' : '-h';
            tmuxArgs = command
                ? ['split-window', splitFlag, '-c', directory, command]
                : ['split-window', splitFlag, '-c', directory];
        } else {
            // Create a new window (default)
            tmuxArgs = command
                ? ['new-window', '-c', directory, command]
                : ['new-window', '-c', directory];
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
 * Open a new terminal window at the specified directory and optionally run a command.
 * If running inside tmux and configured to use it, spawns a tmux window/pane instead.
 */
export async function openTerminal(
    directory: string,
    command?: string
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
        return openTmuxTerminal(directory, command);
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
    spawnDirective: SubagentSpawnDirective
): Promise<{ success: boolean; error?: string; resumed?: boolean }> {
    const config = getParallelWorkConfig();
    const claudeCommand = await getClaudeCommand();

    // Check if we should try to resume a previous session
    let shouldResume = false;
    if (config.autoResume) {
        const sessionCount = await detectClaudeSessions(worktreePath);
        if (sessionCount > 0) {
            shouldResume = true;
            console.log(chalk.cyan('ℹ'), `Found ${sessionCount} previous Claude session(s) - opening resume picker`);
        }
    }

    const command = buildClaudeCommand(issueNumber, issueTitle, worktreePath, claudeCommand, shouldResume);

    // Set the spawn context as an environment variable for Claude to potentially use
    const envJson = JSON.stringify(spawnDirective);
    const fullCommand = `export GHP_SPAWN_CONTEXT='${envJson.replace(/'/g, "'\\''")}' && ${command}`;

    const result = await openTerminal(worktreePath, fullCommand);
    return { ...result, resumed: shouldResume };
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

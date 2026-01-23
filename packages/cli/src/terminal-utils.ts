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
 * Build the command to run in the new terminal
 */
export function buildClaudeCommand(
    issueNumber: number,
    issueTitle: string,
    worktreePath: string,
    claudeCommand: string | null
): string {
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
 * Open a new terminal window at the specified directory and optionally run a command
 */
export async function openTerminal(
    directory: string,
    command?: string
): Promise<{ success: boolean; error?: string }> {
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
 * Open a terminal for parallel work on an issue
 */
export async function openParallelWorkTerminal(
    worktreePath: string,
    issueNumber: number,
    issueTitle: string,
    spawnDirective: SubagentSpawnDirective
): Promise<{ success: boolean; error?: string }> {
    const claudeCommand = await getClaudeCommand();
    const command = buildClaudeCommand(issueNumber, issueTitle, worktreePath, claudeCommand);

    // Set the spawn context as an environment variable for Claude to potentially use
    const envJson = JSON.stringify(spawnDirective);
    const fullCommand = `export GHP_SPAWN_CONTEXT='${envJson.replace(/'/g, "'\\''")}' && ${command}`;

    return openTerminal(worktreePath, fullCommand);
}

/**
 * Get a list of available terminal emulators on the current platform
 */
export async function listAvailableTerminals(): Promise<string[]> {
    const platform = os.platform();
    const terminals = TERMINALS[platform] || [];
    const available: string[] = [];

    for (const terminal of terminals) {
        if (await commandExists(terminal.command)) {
            available.push(terminal.command);
        }
    }

    return available;
}

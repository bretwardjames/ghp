/**
 * Agent management commands for ghp CLI.
 *
 * Tracks and manages parallel Claude agents working on issues.
 */

import chalk from 'chalk';
import {
    listAgents,
    getAgentSummaries,
    getAgent,
    getAgentByIssue,
    unregisterAgent,
    updateAgent,
    createSessionWatcher,
    type AgentSummary,
    type AgentStatus,
    type SessionWatcher,
} from '@bretwardjames/ghp-core';
import { confirmWithDefault, isInteractive } from '../prompts.js';
import { killTmuxWindow, isInsideTmux } from '../terminal-utils.js';
import { exit, registerCleanupHandler } from '../exit.js';

// Track active session watchers
const sessionWatchers: Map<string, SessionWatcher> = new Map();

// Status colors
const STATUS_COLORS: Record<AgentStatus, (s: string) => string> = {
    starting: chalk.yellow,
    running: chalk.green,
    waiting: chalk.yellow,
    stopped: chalk.gray,
    error: chalk.red,
};

// Status symbols
const STATUS_SYMBOLS: Record<AgentStatus, string> = {
    starting: '○',
    running: '●',
    waiting: '⚠',
    stopped: '○',
    error: '✗',
};

/**
 * Format a single agent row for display
 */
function formatAgentRow(agent: AgentSummary, showAction: boolean = false): string {
    // Use 'waiting' status if agent is waiting for input
    const effectiveStatus: AgentStatus = agent.waitingForInput ? 'waiting' : agent.status;
    const statusColor = STATUS_COLORS[effectiveStatus];
    const symbol = STATUS_SYMBOLS[effectiveStatus];
    const portStr = agent.port ? `:${agent.port}` : '';

    const row = [
        statusColor(`${symbol} ${effectiveStatus.padEnd(8)}`),
        chalk.cyan(`#${agent.issueNumber.toString().padEnd(5)}`),
        agent.issueTitle.substring(0, 40).padEnd(40),
        chalk.dim(agent.uptime.padStart(8)),
        chalk.dim(portStr.padStart(6)),
    ].join('  ');

    // Add action line if showing and available
    if (showAction && agent.currentAction) {
        const actionLine = agent.waitingForInput
            ? chalk.yellow(`  └─ ⚠ ${agent.currentAction}`)
            : chalk.dim(`  └─ ${agent.currentAction}`);
        return row + '\n' + actionLine;
    }

    return row;
}

/**
 * List all registered agents
 */
export async function agentsListCommand(options: AgentsListOptions = {}): Promise<void> {
    const summaries = getAgentSummaries();

    if (summaries.length === 0) {
        if (options.json) {
            console.log('[]');
        } else {
            console.log(chalk.dim('No agents running.'));
            console.log();
            console.log('Start an agent with:');
            console.log(chalk.cyan('  ghp start <issue> --parallel'));
        }
        return;
    }

    // JSON output
    if (options.json) {
        const jsonOutput = summaries.map(agent => ({
            id: agent.id,
            issueNumber: agent.issueNumber,
            issueTitle: agent.issueTitle,
            status: agent.waitingForInput ? 'waiting' : agent.status,
            waitingForInput: agent.waitingForInput,
            uptime: agent.uptime,
            port: agent.port,
            branch: agent.branch,
            currentAction: agent.currentAction,
        }));
        console.log(JSON.stringify(jsonOutput, null, 2));
        return;
    }

    // Header
    console.log();
    console.log(chalk.bold('Running Agents'));
    console.log(chalk.dim('─'.repeat(80)));
    console.log(
        chalk.dim('Status'.padEnd(12)),
        chalk.dim('Issue'.padEnd(7)),
        chalk.dim('Title'.padEnd(42)),
        chalk.dim('Uptime'.padStart(8)),
        chalk.dim('Port'.padStart(6))
    );
    console.log(chalk.dim('─'.repeat(80)));

    // Rows
    for (const agent of summaries) {
        console.log(formatAgentRow(agent));
    }

    console.log(chalk.dim('─'.repeat(80)));
    console.log(chalk.dim(`${summaries.length} agent(s)`));
    console.log();
}

interface AgentsListOptions {
    json?: boolean;
}

interface AgentsStopOptions {
    force?: boolean;
    all?: boolean;
}

/**
 * Stop an agent (or all agents)
 */
export async function agentsStopCommand(
    issueArg: string | undefined,
    options: AgentsStopOptions = {}
): Promise<void> {
    if (options.all) {
        await stopAllAgents(options.force);
        return;
    }

    if (!issueArg) {
        console.error(chalk.red('Error:'), 'Issue number required (or use --all)');
        console.log(chalk.dim('Usage: ghp agents stop <issue> [--force]'));
        console.log(chalk.dim('       ghp agents stop --all [--force]'));
        exit(1);
    }

    const issueNumber = parseInt(issueArg, 10);
    if (isNaN(issueNumber)) {
        console.error(chalk.red('Error:'), 'Issue must be a number');
        exit(1);
    }

    const agent = getAgentByIssue(issueNumber);
    if (!agent) {
        console.error(chalk.red('Error:'), `No agent found for issue #${issueNumber}`);
        exit(1);
    }

    // Confirm unless --force
    if (!options.force && isInteractive()) {
        const confirmed = await confirmWithDefault(
            `Stop agent working on #${issueNumber} (${agent.issueTitle})?`,
            true
        );
        if (!confirmed) {
            console.log('Aborted.');
            return;
        }
    }

    await stopAgent(agent.id, issueNumber);
}

/**
 * Stop a single agent by ID
 */
async function stopAgent(agentId: string, issueNumber: number): Promise<void> {
    const agent = getAgent(agentId);
    if (!agent) {
        console.error(chalk.red('Error:'), 'Agent not found');
        return;
    }

    console.log(chalk.dim(`Stopping agent for #${issueNumber}...`));

    // Try to kill the tmux window if we're in tmux
    if (isInsideTmux()) {
        const windowName = `ghp-${issueNumber}`;
        const result = await killTmuxWindow(windowName);
        if (result.success) {
            console.log(chalk.dim(`Killed tmux window: ${windowName}`));
        } else {
            console.log(chalk.dim(`Tmux window not found: ${windowName}`));
        }
    } else if (agent.pid > 0) {
        // Fall back to PID-based kill if not in tmux
        try {
            process.kill(agent.pid, 'SIGTERM');
            console.log(chalk.dim(`Sent SIGTERM to PID ${agent.pid}`));
        } catch (error) {
            // Process might already be dead
            console.log(chalk.dim(`Process ${agent.pid} not running`));
        }
    }

    // Update status and unregister
    updateAgent(agentId, { status: 'stopped' });
    unregisterAgent(agentId);

    console.log(chalk.green('✓'), `Stopped agent for #${issueNumber}`);
}

/**
 * Stop all agents
 */
async function stopAllAgents(force?: boolean): Promise<void> {
    const agents = listAgents();

    if (agents.length === 0) {
        console.log(chalk.dim('No agents running.'));
        return;
    }

    // Confirm unless --force
    if (!force && isInteractive()) {
        const confirmed = await confirmWithDefault(
            `Stop all ${agents.length} agent(s)?`,
            false
        );
        if (!confirmed) {
            console.log('Aborted.');
            return;
        }
    }

    let stopped = 0;
    for (const agent of agents) {
        // Try to kill tmux window
        if (isInsideTmux()) {
            const windowName = `ghp-${agent.issueNumber}`;
            await killTmuxWindow(windowName);
        } else if (agent.pid > 0) {
            try {
                process.kill(agent.pid, 'SIGTERM');
            } catch {
                // Process might already be dead
            }
        }
        unregisterAgent(agent.id);
        stopped++;
    }

    console.log(chalk.green('✓'), `Stopped ${stopped} agent(s)`);
}

interface AgentsWatchOptions {
    interval?: string;
}

/**
 * Start session watchers for all agents
 */
async function startSessionWatchers(): Promise<void> {
    const agents = listAgents();

    for (const agent of agents) {
        // Skip if already watching
        if (sessionWatchers.has(agent.id)) continue;

        try {
            // Pass tmux window name for permission detection
            const tmuxWindowName = `ghp-${agent.issueNumber}`;
            const watcher = await createSessionWatcher(agent.worktreePath, tmuxWindowName);
            if (watcher) {
                // Update registry when status changes
                watcher.on('status', (status) => {
                    updateAgent(agent.id, {
                        currentAction: status.currentAction,
                        waitingForInput: status.waitingForInput,
                    });
                });

                // Handle errors gracefully (don't crash the dashboard)
                watcher.on('error', () => {
                    // Silently ignore - file might be temporarily unavailable
                });

                await watcher.start();
                sessionWatchers.set(agent.id, watcher);
            }
        } catch {
            // Session file might not exist yet
        }
    }

    // Clean up watchers for agents that no longer exist
    const agentIds = new Set(agents.map(a => a.id));
    for (const [id, watcher] of sessionWatchers) {
        if (!agentIds.has(id)) {
            watcher.stop();
            sessionWatchers.delete(id);
        }
    }
}

/**
 * Watch agents with auto-refresh (simple dashboard)
 */
export async function agentsWatchCommand(options: AgentsWatchOptions = {}): Promise<void> {
    const intervalSec = parseInt(options.interval || '2', 10);
    const intervalMs = intervalSec * 1000;

    console.log(chalk.dim(`Watching agents (refresh every ${intervalSec}s, Ctrl+C to exit)`));
    console.log();

    // Start session watchers for all agents
    await startSessionWatchers();

    const refresh = async () => {
        // Start watchers for any new agents
        await startSessionWatchers();

        // Clear screen (keep some context)
        process.stdout.write('\x1b[2J\x1b[H');

        const summaries = getAgentSummaries();
        const now = new Date().toLocaleTimeString();

        // Count waiting agents for header
        const waitingCount = summaries.filter(a => a.waitingForInput).length;
        const headerExtra = waitingCount > 0
            ? chalk.yellow(` │ ⚠ ${waitingCount} waiting`)
            : '';

        console.log(chalk.bold('Agent Dashboard'), chalk.dim(`[${now}]`), headerExtra);
        console.log(chalk.dim('─'.repeat(80)));

        if (summaries.length === 0) {
            console.log();
            console.log(chalk.dim('No agents running.'));
            console.log();
        } else {
            console.log(
                chalk.dim('Status'.padEnd(12)),
                chalk.dim('Issue'.padEnd(7)),
                chalk.dim('Title'.padEnd(42)),
                chalk.dim('Uptime'.padStart(8)),
                chalk.dim('Port'.padStart(6))
            );
            console.log(chalk.dim('─'.repeat(80)));

            for (const agent of summaries) {
                console.log(formatAgentRow(agent, true)); // Show action
            }
        }

        console.log(chalk.dim('─'.repeat(80)));
        console.log(chalk.dim(`${summaries.length} agent(s) | Refresh: ${intervalSec}s | Ctrl+C to exit`));
    };

    // Initial render
    await refresh();

    // Set up refresh interval (wrap async to catch errors)
    const timer = setInterval(() => {
        refresh().catch(() => {
            // Silently ignore refresh errors
        });
    }, intervalMs);

    // Register cleanup handler for graceful shutdown
    registerCleanupHandler(() => {
        clearInterval(timer);
        // Stop all session watchers
        for (const watcher of sessionWatchers.values()) {
            watcher.stop();
        }
        sessionWatchers.clear();
        console.log();
        console.log(chalk.dim('Stopped watching.'));
    });

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
        exit(0);
    });

    // Keep process alive
    await new Promise(() => {});
}

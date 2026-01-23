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
    type AgentSummary,
    type AgentStatus,
} from '@bretwardjames/ghp-core';
import { confirmWithDefault, isInteractive } from '../prompts.js';
import { killTmuxWindow, isInsideTmux } from '../terminal-utils.js';

// Status colors
const STATUS_COLORS: Record<AgentStatus, (s: string) => string> = {
    starting: chalk.yellow,
    running: chalk.green,
    stopped: chalk.gray,
    error: chalk.red,
};

// Status symbols
const STATUS_SYMBOLS: Record<AgentStatus, string> = {
    starting: '○',
    running: '●',
    stopped: '○',
    error: '✗',
};

/**
 * Format a single agent row for display
 */
function formatAgentRow(agent: AgentSummary): string {
    const statusColor = STATUS_COLORS[agent.status];
    const symbol = STATUS_SYMBOLS[agent.status];
    const portStr = agent.port ? `:${agent.port}` : '';

    return [
        statusColor(`${symbol} ${agent.status.padEnd(8)}`),
        chalk.cyan(`#${agent.issueNumber.toString().padEnd(5)}`),
        agent.issueTitle.substring(0, 40).padEnd(40),
        chalk.dim(agent.uptime.padStart(8)),
        chalk.dim(portStr.padStart(6)),
    ].join('  ');
}

/**
 * List all registered agents
 */
export async function agentsListCommand(): Promise<void> {
    const summaries = getAgentSummaries();

    if (summaries.length === 0) {
        console.log(chalk.dim('No agents running.'));
        console.log();
        console.log('Start an agent with:');
        console.log(chalk.cyan('  ghp start <issue> --parallel'));
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
        process.exit(1);
    }

    const issueNumber = parseInt(issueArg, 10);
    if (isNaN(issueNumber)) {
        console.error(chalk.red('Error:'), 'Issue must be a number');
        process.exit(1);
    }

    const agent = getAgentByIssue(issueNumber);
    if (!agent) {
        console.error(chalk.red('Error:'), `No agent found for issue #${issueNumber}`);
        process.exit(1);
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
 * Watch agents with auto-refresh (simple dashboard)
 */
export async function agentsWatchCommand(options: AgentsWatchOptions = {}): Promise<void> {
    const intervalSec = parseInt(options.interval || '2', 10);
    const intervalMs = intervalSec * 1000;

    console.log(chalk.dim(`Watching agents (refresh every ${intervalSec}s, Ctrl+C to exit)`));
    console.log();

    const refresh = () => {
        // Clear screen (keep some context)
        process.stdout.write('\x1b[2J\x1b[H');

        const summaries = getAgentSummaries();
        const now = new Date().toLocaleTimeString();

        console.log(chalk.bold('Agent Dashboard'), chalk.dim(`[${now}]`));
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
                console.log(formatAgentRow(agent));
            }
        }

        console.log(chalk.dim('─'.repeat(80)));
        console.log(chalk.dim(`${summaries.length} agent(s) | Refresh: ${intervalSec}s | Ctrl+C to exit`));
    };

    // Initial render
    refresh();

    // Set up refresh interval
    const timer = setInterval(refresh, intervalMs);

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
        clearInterval(timer);
        console.log();
        console.log(chalk.dim('Stopped watching.'));
        process.exit(0);
    });

    // Keep process alive
    await new Promise(() => {});
}

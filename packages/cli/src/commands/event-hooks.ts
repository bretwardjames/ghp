/**
 * Event Hooks CLI Commands
 *
 * Manage event hooks that run on ghp lifecycle events.
 */

import chalk from 'chalk';
import {
    getEventHooks,
    getEventHook,
    addEventHook,
    removeEventHook,
    enableEventHook,
    disableEventHook,
    getEventHooksConfigPath,
    getValidEventTypes,
    type EventHook,
    type EventType,
} from '@bretwardjames/ghp-core';

// =============================================================================
// List Hooks
// =============================================================================

/**
 * List all registered event hooks
 */
export function hooksListCommand(): void {
    const hooks = getEventHooks();
    const validEvents = getValidEventTypes();

    console.log(chalk.bold('Event Hooks'));
    console.log(chalk.dim('─'.repeat(60)));
    console.log();

    if (hooks.length === 0) {
        console.log(chalk.dim('No hooks registered.'));
        console.log();
        console.log('Add a hook with:');
        console.log(chalk.cyan('  ghp hooks add <name> --event <event> --command "<cmd>"'));
        console.log();
        console.log('Available events:', validEvents.join(', '));
        console.log();
        console.log('Example (ragtime integration):');
        console.log(chalk.dim('  ghp hooks add ragtime-context \\'));
        console.log(chalk.dim('    --event issue-started \\'));
        console.log(chalk.dim('    --command "ragtime new-branch \\${issue.number} --issue-json \'\\${issue.json}\'"'));
        console.log();
        console.log('Config file:', chalk.dim(getEventHooksConfigPath()));
        return;
    }

    // Group hooks by event
    const byEvent = new Map<EventType, EventHook[]>();
    for (const hook of hooks) {
        if (!byEvent.has(hook.event)) {
            byEvent.set(hook.event, []);
        }
        byEvent.get(hook.event)!.push(hook);
    }

    for (const event of validEvents) {
        const eventHooks = byEvent.get(event) || [];
        if (eventHooks.length === 0) continue;

        console.log(chalk.bold(event));
        for (const hook of eventHooks) {
            printHookSummary(hook);
        }
        console.log();
    }

    console.log(chalk.dim(`Config: ${getEventHooksConfigPath()}`));
}

/**
 * Print a hook summary line
 */
function printHookSummary(hook: EventHook): void {
    const statusIcon = hook.enabled ? chalk.green('●') : chalk.dim('○');
    const name = hook.enabled ? chalk.white(hook.name) : chalk.dim(hook.name);

    console.log(`  ${statusIcon} ${name}`);
    console.log(chalk.dim(`    ${hook.command}`));
}

// =============================================================================
// Add Hook
// =============================================================================

export interface HooksAddOptions {
    event?: string;
    command?: string;
    displayName?: string;
    timeout?: string;
}

/**
 * Add a new event hook
 */
export function hooksAddCommand(name: string, options: HooksAddOptions): void {
    const validEvents = getValidEventTypes();

    if (!options.event) {
        console.error(chalk.red('Error:'), 'Event is required. Use --event <event>');
        console.log('Valid events:', validEvents.join(', '));
        process.exit(1);
    }

    if (!validEvents.includes(options.event as EventType)) {
        console.error(chalk.red('Error:'), `Invalid event: ${options.event}`);
        console.log('Valid events:', validEvents.join(', '));
        process.exit(1);
    }

    if (!options.command) {
        console.error(chalk.red('Error:'), 'Command is required. Use --command "<cmd>"');
        process.exit(1);
    }

    // Validate timeout if provided
    let timeout = 30000;
    if (options.timeout) {
        timeout = parseInt(options.timeout, 10);
        if (isNaN(timeout) || timeout <= 0) {
            console.error(chalk.red('Error:'), 'Timeout must be a positive number');
            process.exit(1);
        }
    }

    // Security warning
    console.log(chalk.yellow('Note:'), 'Hooks execute shell commands. Only add commands from trusted sources.');
    console.log();

    try {
        const hook = addEventHook({
            name,
            displayName: options.displayName || name,
            event: options.event as EventType,
            command: options.command,
            timeout,
        });

        console.log(chalk.green('✓'), `Added hook "${hook.name}"`);
        console.log();
        printHookDetails(hook);

        console.log();
        console.log(chalk.dim('Template variables available:'));
        console.log(chalk.dim('  ${issue.number}, ${issue.json}, ${issue.title}, ${issue.body}'));
        console.log(chalk.dim('  ${branch}, ${repo}, ${pr.number}, ${pr.json}'));
    } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message);
        process.exit(1);
    }
}

// =============================================================================
// Remove Hook
// =============================================================================

/**
 * Remove a hook
 */
export function hooksRemoveCommand(name: string): void {
    const hook = getEventHook(name);
    if (!hook) {
        console.error(chalk.red('Error:'), `Hook "${name}" not found`);
        process.exit(1);
    }

    const removed = removeEventHook(name);
    if (removed) {
        console.log(chalk.green('✓'), `Removed hook "${name}"`);
    } else {
        console.error(chalk.red('Error:'), `Failed to remove hook "${name}"`);
        process.exit(1);
    }
}

// =============================================================================
// Enable/Disable Hook
// =============================================================================

/**
 * Enable a hook
 */
export function hooksEnableCommand(name: string): void {
    try {
        const hook = enableEventHook(name);
        console.log(chalk.green('✓'), `Enabled hook "${hook.name}"`);
    } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message);
        process.exit(1);
    }
}

/**
 * Disable a hook
 */
export function hooksDisableCommand(name: string): void {
    try {
        const hook = disableEventHook(name);
        console.log(chalk.yellow('○'), `Disabled hook "${hook.name}"`);
    } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message);
        process.exit(1);
    }
}

// =============================================================================
// Show Hook Details
// =============================================================================

/**
 * Show details of a specific hook
 */
export function hooksShowCommand(name: string): void {
    const hook = getEventHook(name);
    if (!hook) {
        console.error(chalk.red('Error:'), `Hook "${name}" not found`);
        process.exit(1);
    }

    printHookDetails(hook);
}

/**
 * Print full hook details
 */
function printHookDetails(hook: EventHook): void {
    const status = hook.enabled ? chalk.green('enabled') : chalk.dim('disabled');

    console.log(chalk.bold(hook.displayName || hook.name), chalk.dim(`(${hook.name})`));
    console.log();
    console.log('  Status: ', status);
    console.log('  Event:  ', hook.event);
    console.log('  Command:', chalk.cyan(hook.command));
    console.log('  Timeout:', `${hook.timeout || 30000}ms`);
}

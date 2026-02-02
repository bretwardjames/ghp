/**
 * Dashboard Hooks CLI Commands
 *
 * Manage external content providers for the branch dashboard.
 */

import chalk from 'chalk';
import {
    getHooks,
    getHook,
    addHook,
    removeHook,
    enableHook,
    disableHook,
    getHooksConfigPath,
    type DashboardHook,
} from '@bretwardjames/ghp-core';
import { exit } from '../exit.js';

/**
 * List all registered hooks
 */
export function hooksListCommand(): void {
    const hooks = getHooks();

    if (hooks.length === 0) {
        console.log(chalk.dim('No hooks registered.'));
        console.log();
        console.log('Add a hook with:');
        console.log(chalk.cyan('  ghp dashboard hooks add <name> --command "<cmd>"'));
        console.log();
        console.log('Config file:', chalk.dim(getHooksConfigPath()));
        return;
    }

    console.log(chalk.bold('Dashboard Hooks'));
    console.log(chalk.dim('─'.repeat(60)));
    console.log();

    for (const hook of hooks) {
        const status = hook.enabled
            ? chalk.green('●')
            : chalk.dim('○');
        const name = hook.enabled
            ? chalk.white(hook.name)
            : chalk.dim(hook.name);
        const displayName = hook.displayName !== hook.name
            ? chalk.dim(` (${hook.displayName})`)
            : '';

        console.log(`  ${status} ${name}${displayName}`);
        console.log(chalk.dim(`    Command: ${hook.command}`));
        console.log(chalk.dim(`    Category: ${hook.category}`));
        if (hook.timeout && hook.timeout !== 5000) {
            console.log(chalk.dim(`    Timeout: ${hook.timeout}ms`));
        }
        console.log();
    }

    console.log(chalk.dim('Config: ' + getHooksConfigPath()));
}

/**
 * Options for adding a hook
 */
export interface HooksAddOptions {
    command?: string;
    displayName?: string;
    category?: string;
    timeout?: string;
}

/**
 * Add a new hook
 */
export function hooksAddCommand(name: string, options: HooksAddOptions): void {
    if (!options.command) {
        console.error(chalk.red('Error:'), 'Command is required. Use --command "<cmd>"');
        exit(1);
    }

    // Validate timeout if provided
    let timeout = 5000;
    if (options.timeout) {
        timeout = parseInt(options.timeout, 10);
        if (isNaN(timeout) || timeout <= 0) {
            console.error(chalk.red('Error:'), 'Timeout must be a positive number');
            exit(1);
        }
    }

    // Security warning
    console.log(chalk.yellow('Note:'), 'Hooks execute shell commands. Only add commands from trusted sources.');
    console.log();

    try {
        const hook = addHook({
            name,
            displayName: options.displayName || name,
            command: options.command,
            category: options.category || 'other',
            timeout,
        });

        console.log(chalk.green('✓'), `Added hook "${hook.name}"`);
        console.log();
        printHookDetails(hook);
    } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message);
        exit(1);
    }
}

/**
 * Remove a hook
 */
export function hooksRemoveCommand(name: string): void {
    const hook = getHook(name);
    if (!hook) {
        console.error(chalk.red('Error:'), `Hook "${name}" not found`);
        exit(1);
    }

    const removed = removeHook(name);
    if (removed) {
        console.log(chalk.green('✓'), `Removed hook "${name}"`);
    } else {
        console.error(chalk.red('Error:'), `Failed to remove hook "${name}"`);
        exit(1);
    }
}

/**
 * Enable a hook
 */
export function hooksEnableCommand(name: string): void {
    try {
        const hook = enableHook(name);
        console.log(chalk.green('✓'), `Enabled hook "${hook.name}"`);
    } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message);
        exit(1);
    }
}

/**
 * Disable a hook
 */
export function hooksDisableCommand(name: string): void {
    try {
        const hook = disableHook(name);
        console.log(chalk.yellow('○'), `Disabled hook "${hook.name}"`);
    } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message);
        exit(1);
    }
}

/**
 * Show details of a specific hook
 */
export function hooksShowCommand(name: string): void {
    const hook = getHook(name);
    if (!hook) {
        console.error(chalk.red('Error:'), `Hook "${name}" not found`);
        exit(1);
    }

    printHookDetails(hook);
}

/**
 * Print hook details
 */
function printHookDetails(hook: DashboardHook): void {
    const status = hook.enabled ? chalk.green('enabled') : chalk.dim('disabled');

    console.log(chalk.bold(hook.displayName), chalk.dim(`(${hook.name})`));
    console.log();
    console.log('  Status:  ', status);
    console.log('  Command: ', chalk.cyan(hook.command));
    console.log('  Category:', hook.category);
    console.log('  Timeout: ', `${hook.timeout || 5000}ms`);
}

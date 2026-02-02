/**
 * CLI Flag Validation Utilities
 *
 * Provides validation functions for CLI flags that accept specific values.
 * Used to provide clear error messages when invalid values are provided.
 *
 * ## Usage
 *
 * ```typescript
 * import { validateEnum, validateMutualExclusion, validatePositiveNumber } from './validation.js';
 *
 * // In command handler:
 * validateEnum(options.branchAction, BRANCH_ACTIONS, '--branch-action');
 * validateMutualExclusion(['--squash', '--rebase'], [options.squash, options.rebase]);
 * validatePositiveNumber(options.timeout, '--timeout');
 * ```
 */

import chalk from 'chalk';
import { exit } from './exit.js';

// =============================================================================
// Valid Values
// =============================================================================

/** Valid values for --branch-action flag in start command */
export const BRANCH_ACTIONS = ['create', 'link', 'skip'] as const;
export type BranchAction = typeof BRANCH_ACTIONS[number];

/** Valid values for --assign flag (action mode) in start command */
export const ASSIGN_ACTIONS = ['reassign', 'add', 'skip'] as const;
export type AssignAction = typeof ASSIGN_ACTIONS[number];

/** Valid values for --group flag in work/plan commands */
export const GROUP_FIELDS = ['status', 'type', 'assignee', 'priority', 'size', 'labels'] as const;
export type GroupField = typeof GROUP_FIELDS[number];

/** Valid values for --mode flag in event hooks */
export const HOOK_MODES = ['fire-and-forget', 'blocking', 'interactive'] as const;
export type HookMode = typeof HOOK_MODES[number];

/**
 * Note: HOOK_MODES is defined here for documentation but validation is handled
 * by getValidModes() from @bretwardjames/ghp-core in event-hooks.ts.
 * Terminal modes are validated via mutual exclusion of --nvim/--claude/--terminal-only flags.
 */

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validate that a value is one of the allowed options.
 * Exits with helpful error message if invalid.
 *
 * @param value - The value to validate (may be undefined)
 * @param allowed - Array of valid values
 * @param flagName - Name of the flag (for error messages)
 * @param exitOnError - Whether to exit on error (default: true)
 * @returns true if valid, false if invalid (only when exitOnError is false)
 */
export function validateEnum<T extends string>(
    value: string | undefined,
    allowed: readonly T[],
    flagName: string,
    exitOnError = true
): value is T | undefined {
    if (value === undefined) {
        return true; // undefined is valid (flag not provided)
    }

    if (!allowed.includes(value as T)) {
        console.error(chalk.red('Error:'), `Invalid value for ${flagName}: "${value}"`);
        console.log('Valid values:', allowed.join(', '));
        if (exitOnError) {
            exit(1);
        }
        return false;
    }

    return true;
}

/**
 * Validate that mutually exclusive flags aren't used together.
 * Exits with helpful error message if multiple are set.
 *
 * @param flagNames - Names of the mutually exclusive flags
 * @param flagValues - Corresponding values (truthy means flag is set)
 * @param exitOnError - Whether to exit on error (default: true)
 * @returns true if valid, false if invalid (only when exitOnError is false)
 */
export function validateMutualExclusion(
    flagNames: string[],
    flagValues: (boolean | string | undefined)[],
    exitOnError = true
): boolean {
    const setFlags = flagNames.filter((_, i) => flagValues[i]);

    if (setFlags.length > 1) {
        console.error(chalk.red('Error:'), `Flags ${setFlags.join(' and ')} cannot be used together`);
        console.log('These flags are mutually exclusive. Use only one.');
        if (exitOnError) {
            exit(1);
        }
        return false;
    }

    return true;
}

/**
 * Validate that a numeric value is positive.
 * Exits with helpful error message if invalid.
 *
 * @param value - The value to validate (may be undefined or string)
 * @param flagName - Name of the flag (for error messages)
 * @param min - Minimum allowed value (default: 1)
 * @param max - Maximum allowed value (optional)
 * @param exitOnError - Whether to exit on error (default: true)
 * @returns The parsed number if valid, undefined if not provided
 */
export function validatePositiveNumber(
    value: string | number | undefined,
    flagName: string,
    min = 1,
    max?: number,
    exitOnError = true
): number | undefined {
    if (value === undefined) {
        return undefined;
    }

    const num = typeof value === 'string' ? parseInt(value, 10) : value;

    if (isNaN(num)) {
        console.error(chalk.red('Error:'), `${flagName} must be a number`);
        if (exitOnError) {
            exit(1);
        }
        return undefined;
    }

    if (num < min) {
        console.error(chalk.red('Error:'), `${flagName} must be at least ${min}`);
        if (exitOnError) {
            exit(1);
        }
        return undefined;
    }

    if (max !== undefined && num > max) {
        console.error(chalk.red('Error:'), `${flagName} must be at most ${max}`);
        if (exitOnError) {
            exit(1);
        }
        return undefined;
    }

    return num;
}

/**
 * Validate that a required value is provided.
 * Exits with helpful error message if missing.
 *
 * @param value - The value to check
 * @param flagName - Name of the flag (for error messages)
 * @param exitOnError - Whether to exit on error (default: true)
 * @returns true if valid, false if missing (only when exitOnError is false)
 */
export function validateRequired(
    value: unknown,
    flagName: string,
    exitOnError = true
): boolean {
    if (value === undefined || value === null || value === '') {
        console.error(chalk.red('Error:'), `${flagName} is required`);
        if (exitOnError) {
            exit(1);
        }
        return false;
    }

    return true;
}

/**
 * Create a commander argParser that validates enum values.
 * Use this with .argParser() to validate during option parsing.
 *
 * @param allowed - Array of valid values
 * @param flagName - Name of the flag (for error messages)
 * @returns A parser function for commander
 */
export function enumArgParser<T extends string>(
    allowed: readonly T[],
    flagName: string
): (value: string) => T {
    return (value: string): T => {
        if (!allowed.includes(value as T)) {
            console.error(chalk.red('Error:'), `Invalid value for ${flagName}: "${value}"`);
            console.log('Valid values:', allowed.join(', '));
            exit(1);
        }
        return value as T;
    };
}

/**
 * Print a deprecation warning for a renamed flag.
 *
 * @param oldFlag - The deprecated flag name
 * @param newFlag - The new flag name to use
 */
export function warnDeprecatedFlag(oldFlag: string, newFlag: string): void {
    console.warn(
        chalk.yellow('Warning:'),
        `${oldFlag} is deprecated, use ${newFlag} instead`
    );
}

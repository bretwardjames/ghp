/**
 * Tests for CLI flag validation utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    validateEnum,
    validateMutualExclusion,
    validatePositiveNumber,
    validateRequired,
    enumArgParser,
    warnDeprecatedFlag,
    BRANCH_ACTIONS,
    ASSIGN_ACTIONS,
    GROUP_FIELDS,
    HOOK_MODES,
} from './validation.js';

// Mock the exit function to throw instead of exiting
vi.mock('./exit.js', () => ({
    exit: vi.fn((code: number) => {
        throw new Error(`exit(${code})`);
    }),
}));

// Capture console output
let consoleOutput: string[] = [];
const originalConsoleError = console.error;
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;

beforeEach(() => {
    consoleOutput = [];
    console.error = vi.fn((...args: any[]) => {
        consoleOutput.push(args.join(' '));
    });
    console.log = vi.fn((...args: any[]) => {
        consoleOutput.push(args.join(' '));
    });
    console.warn = vi.fn((...args: any[]) => {
        consoleOutput.push(args.join(' '));
    });
});

afterEach(() => {
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    vi.clearAllMocks();
});

// =============================================================================
// validateEnum tests
// =============================================================================

describe('validateEnum', () => {
    it('should return true for undefined value (flag not provided)', () => {
        expect(validateEnum(undefined, BRANCH_ACTIONS, '--branch-action')).toBe(true);
    });

    it('should return true for valid enum value', () => {
        expect(validateEnum('create', BRANCH_ACTIONS, '--branch-action')).toBe(true);
        expect(validateEnum('link', BRANCH_ACTIONS, '--branch-action')).toBe(true);
        expect(validateEnum('skip', BRANCH_ACTIONS, '--branch-action')).toBe(true);
    });

    it('should exit with error for invalid enum value', () => {
        expect(() => {
            validateEnum('invalid', BRANCH_ACTIONS, '--branch-action');
        }).toThrow('exit(1)');

        expect(consoleOutput.some(line => line.includes('Invalid value for --branch-action'))).toBe(true);
        expect(consoleOutput.some(line => line.includes('create, link, skip'))).toBe(true);
    });

    it('should return false for invalid value when exitOnError is false', () => {
        const result = validateEnum('invalid', BRANCH_ACTIONS, '--branch-action', false);
        expect(result).toBe(false);
        expect(consoleOutput.some(line => line.includes('Invalid value'))).toBe(true);
    });

    it('should validate all ASSIGN_ACTIONS', () => {
        for (const action of ASSIGN_ACTIONS) {
            expect(validateEnum(action, ASSIGN_ACTIONS, '--assign')).toBe(true);
        }
    });

    it('should validate all GROUP_FIELDS', () => {
        for (const field of GROUP_FIELDS) {
            expect(validateEnum(field, GROUP_FIELDS, '--group')).toBe(true);
        }
    });

    it('should validate all HOOK_MODES', () => {
        for (const mode of HOOK_MODES) {
            expect(validateEnum(mode, HOOK_MODES, '--mode')).toBe(true);
        }
    });
});

// =============================================================================
// validateMutualExclusion tests
// =============================================================================

describe('validateMutualExclusion', () => {
    it('should return true when no flags are set', () => {
        const result = validateMutualExclusion(
            ['--squash', '--rebase'],
            [undefined, undefined]
        );
        expect(result).toBe(true);
    });

    it('should return true when only one flag is set', () => {
        const result = validateMutualExclusion(
            ['--squash', '--rebase'],
            [true, undefined]
        );
        expect(result).toBe(true);
    });

    it('should exit with error when multiple flags are set', () => {
        expect(() => {
            validateMutualExclusion(
                ['--squash', '--rebase'],
                [true, true]
            );
        }).toThrow('exit(1)');

        expect(consoleOutput.some(line => line.includes('--squash and --rebase cannot be used together'))).toBe(true);
    });

    it('should return false when multiple flags are set and exitOnError is false', () => {
        const result = validateMutualExclusion(
            ['--squash', '--rebase'],
            [true, true],
            false
        );
        expect(result).toBe(false);
    });

    it('should handle three mutually exclusive flags', () => {
        // Only one set - valid
        expect(validateMutualExclusion(
            ['--nvim', '--claude', '--terminal-only'],
            [true, undefined, undefined]
        )).toBe(true);

        // Two set - invalid
        expect(() => {
            validateMutualExclusion(
                ['--nvim', '--claude', '--terminal-only'],
                [true, true, undefined]
            );
        }).toThrow('exit(1)');

        // All three set - invalid
        expect(() => {
            validateMutualExclusion(
                ['--nvim', '--claude', '--terminal-only'],
                [true, true, true]
            );
        }).toThrow('exit(1)');
    });

    it('should treat string values as truthy', () => {
        expect(() => {
            validateMutualExclusion(
                ['--flag1', '--flag2'],
                ['value1', 'value2']
            );
        }).toThrow('exit(1)');
    });
});

// =============================================================================
// validatePositiveNumber tests
// =============================================================================

describe('validatePositiveNumber', () => {
    it('should return undefined for undefined value', () => {
        expect(validatePositiveNumber(undefined, '--timeout')).toBeUndefined();
    });

    it('should return parsed number for valid string', () => {
        expect(validatePositiveNumber('5000', '--timeout')).toBe(5000);
    });

    it('should return number for valid number', () => {
        expect(validatePositiveNumber(5000, '--timeout')).toBe(5000);
    });

    it('should exit with error for non-numeric string', () => {
        expect(() => {
            validatePositiveNumber('abc', '--timeout');
        }).toThrow('exit(1)');

        expect(consoleOutput.some(line => line.includes('--timeout must be a number'))).toBe(true);
    });

    it('should exit with error for number below minimum', () => {
        expect(() => {
            validatePositiveNumber(0, '--timeout', 1);
        }).toThrow('exit(1)');

        expect(consoleOutput.some(line => line.includes('--timeout must be at least 1'))).toBe(true);
    });

    it('should exit with error for number above maximum', () => {
        expect(() => {
            validatePositiveNumber(200000, '--max-diff-lines', 1, 100000);
        }).toThrow('exit(1)');

        expect(consoleOutput.some(line => line.includes('--max-diff-lines must be at most 100000'))).toBe(true);
    });

    it('should accept number at boundary', () => {
        expect(validatePositiveNumber(1, '--timeout', 1)).toBe(1);
        expect(validatePositiveNumber(100000, '--max-diff-lines', 1, 100000)).toBe(100000);
    });

    it('should return undefined for invalid value when exitOnError is false', () => {
        const result = validatePositiveNumber('abc', '--timeout', 1, undefined, false);
        expect(result).toBeUndefined();
    });
});

// =============================================================================
// validateRequired tests
// =============================================================================

describe('validateRequired', () => {
    it('should return true for truthy values', () => {
        expect(validateRequired('value', '--flag')).toBe(true);
        expect(validateRequired(123, '--flag')).toBe(true);
        expect(validateRequired(['item'], '--flag')).toBe(true);
    });

    it('should exit with error for undefined', () => {
        expect(() => {
            validateRequired(undefined, '--flag');
        }).toThrow('exit(1)');

        expect(consoleOutput.some(line => line.includes('--flag is required'))).toBe(true);
    });

    it('should exit with error for null', () => {
        expect(() => {
            validateRequired(null, '--flag');
        }).toThrow('exit(1)');
    });

    it('should exit with error for empty string', () => {
        expect(() => {
            validateRequired('', '--flag');
        }).toThrow('exit(1)');
    });

    it('should return false for missing value when exitOnError is false', () => {
        const result = validateRequired(undefined, '--flag', false);
        expect(result).toBe(false);
    });
});

// =============================================================================
// enumArgParser tests
// =============================================================================

describe('enumArgParser', () => {
    it('should return valid value unchanged', () => {
        const parser = enumArgParser(BRANCH_ACTIONS, '--branch-action');
        expect(parser('create')).toBe('create');
        expect(parser('link')).toBe('link');
        expect(parser('skip')).toBe('skip');
    });

    it('should exit with error for invalid value', () => {
        const parser = enumArgParser(BRANCH_ACTIONS, '--branch-action');
        expect(() => {
            parser('invalid');
        }).toThrow('exit(1)');

        expect(consoleOutput.some(line => line.includes('Invalid value for --branch-action'))).toBe(true);
    });
});

// =============================================================================
// warnDeprecatedFlag tests
// =============================================================================

describe('warnDeprecatedFlag', () => {
    it('should print deprecation warning with old and new flag names', () => {
        warnDeprecatedFlag('--old-flag', '--new-flag');
        expect(consoleOutput.some(line => line.includes('--old-flag is deprecated'))).toBe(true);
        expect(consoleOutput.some(line => line.includes('--new-flag'))).toBe(true);
    });
});

// =============================================================================
// Integration tests - flag value exports
// =============================================================================

describe('Flag value constants', () => {
    it('should export BRANCH_ACTIONS with correct values', () => {
        expect(BRANCH_ACTIONS).toEqual(['create', 'link', 'skip']);
    });

    it('should export ASSIGN_ACTIONS with correct values', () => {
        expect(ASSIGN_ACTIONS).toEqual(['reassign', 'add', 'skip']);
    });

    it('should export GROUP_FIELDS with correct values', () => {
        expect(GROUP_FIELDS).toEqual(['status', 'type', 'assignee', 'priority', 'size', 'labels']);
    });

    it('should export HOOK_MODES with correct values', () => {
        expect(HOOK_MODES).toEqual(['fire-and-forget', 'blocking', 'interactive']);
    });
});

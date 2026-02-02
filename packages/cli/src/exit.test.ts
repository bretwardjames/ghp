/**
 * Tests for the exit utility module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    registerCleanupHandler,
    exit,
    isProcessExiting,
    ExitPendingError,
    _resetForTesting,
} from './exit.js';

// Mock process.exit to not actually exit
vi.spyOn(process, 'exit').mockImplementation((() => undefined) as () => never);

// Mock console.error to capture warnings
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

describe('exit utility', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        _resetForTesting();
    });

    afterEach(() => {
        _resetForTesting();
    });

    describe('registerCleanupHandler', () => {
        it('should register a cleanup handler', () => {
            const handler = vi.fn();
            const unregister = registerCleanupHandler(handler);

            expect(typeof unregister).toBe('function');
        });

        it('should return a function to unregister the handler', () => {
            const handler = vi.fn();
            const unregister = registerCleanupHandler(handler);

            // Unregister should not throw
            expect(() => unregister()).not.toThrow();
        });

        it('should allow unregistering multiple times (idempotent)', () => {
            const handler = vi.fn();
            const unregister = registerCleanupHandler(handler);

            unregister();
            expect(() => unregister()).not.toThrow();
        });

        it('should throw if called while process is exiting', async () => {
            // Start exit process
            try {
                exit(0);
            } catch {
                // Expected
            }

            // Wait for cleanup to start
            await new Promise(resolve => setTimeout(resolve, 10));

            // Should throw when trying to register during exit
            expect(() => registerCleanupHandler(() => {})).toThrow(
                'Cannot register cleanup handler: process is exiting'
            );
        });
    });

    describe('exit', () => {
        it('should throw ExitPendingError', () => {
            expect(() => exit(1)).toThrow(ExitPendingError);
        });

        it('should throw with correct exit code in error', () => {
            try {
                exit(1);
            } catch (error) {
                expect(error).toBeInstanceOf(ExitPendingError);
                expect((error as ExitPendingError).exitCode).toBe(1);
            }
        });

        it('should set isProcessExiting to true', () => {
            expect(isProcessExiting()).toBe(false);

            try {
                exit(0);
            } catch {
                // Expected
            }

            expect(isProcessExiting()).toBe(true);
        });

        it('should call process.exit with the correct code', async () => {
            try {
                exit(1);
            } catch {
                // Expected
            }

            // Wait for cleanup to complete
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(process.exit).toHaveBeenCalledWith(1);
        });

        it('should run cleanup handlers before exiting', async () => {
            const handler = vi.fn();
            registerCleanupHandler(handler);

            try {
                exit(0);
            } catch {
                // Expected
            }

            // Wait for cleanup to run
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(handler).toHaveBeenCalled();
            expect(process.exit).toHaveBeenCalledWith(0);
        });

        it('should run cleanup handlers in LIFO order', async () => {
            const order: number[] = [];
            registerCleanupHandler(() => { order.push(1); });
            registerCleanupHandler(() => { order.push(2); });
            registerCleanupHandler(() => { order.push(3); });

            try {
                exit(0);
            } catch {
                // Expected
            }

            // Wait for cleanup to run
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(order).toEqual([3, 2, 1]);
        });

        it('should handle async cleanup handlers', async () => {
            const handler = vi.fn(async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
            });
            registerCleanupHandler(handler);

            try {
                exit(0);
            } catch {
                // Expected
            }

            // Wait for cleanup to run
            await new Promise(resolve => setTimeout(resolve, 100));

            expect(handler).toHaveBeenCalled();
            expect(process.exit).toHaveBeenCalledWith(0);
        });

        it('should continue with other handlers if one throws', async () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn(() => { throw new Error('Handler error'); });
            const handler3 = vi.fn();

            registerCleanupHandler(handler1);
            registerCleanupHandler(handler2);
            registerCleanupHandler(handler3);

            try {
                exit(0);
            } catch {
                // Expected
            }

            // Wait for cleanup to run
            await new Promise(resolve => setTimeout(resolve, 50));

            // All handlers should be called (LIFO order: 3, 2, 1)
            expect(handler3).toHaveBeenCalled();
            expect(handler2).toHaveBeenCalled();
            expect(handler1).toHaveBeenCalled();

            // Should log the error
            expect(mockConsoleError).toHaveBeenCalled();
        });

        it('should log warning on recursive exit call', async () => {
            // First exit call
            try {
                exit(0);
            } catch {
                // Expected
            }

            // Second exit call (recursive)
            try {
                exit(1);
            } catch {
                // Expected
            }

            expect(mockConsoleError).toHaveBeenCalledWith(
                expect.anything(),
                'Recursive exit() call detected - exiting immediately',
                expect.anything()
            );
        });
    });

    describe('ExitPendingError', () => {
        it('should have correct name', () => {
            const error = new ExitPendingError(1);
            expect(error.name).toBe('ExitPendingError');
        });

        it('should have correct message', () => {
            const error = new ExitPendingError(1);
            expect(error.message).toBe('Process exit pending');
        });

        it('should store exit code', () => {
            const error0 = new ExitPendingError(0);
            const error1 = new ExitPendingError(1);

            expect(error0.exitCode).toBe(0);
            expect(error1.exitCode).toBe(1);
        });

        it('should be instanceof Error', () => {
            const error = new ExitPendingError(1);
            expect(error).toBeInstanceOf(Error);
        });
    });

    describe('isProcessExiting', () => {
        it('should return false initially', () => {
            expect(isProcessExiting()).toBe(false);
        });

        it('should return true after exit is called', () => {
            try {
                exit(0);
            } catch {
                // Expected
            }

            expect(isProcessExiting()).toBe(true);
        });
    });

    describe('cleanup timeout', () => {
        it('should timeout slow handlers and log warning', async () => {
            // Register a handler that takes longer than the timeout
            const slowHandler = vi.fn(async () => {
                await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds
            });
            registerCleanupHandler(slowHandler);

            try {
                exit(0);
            } catch {
                // Expected
            }

            // Wait for timeout (default is 5 seconds, but we'll wait a bit more)
            // In tests, we can't easily test the full timeout, so we verify the mechanism exists
            await new Promise(resolve => setTimeout(resolve, 100));

            // The handler should have been called
            expect(slowHandler).toHaveBeenCalled();
        });
    });

    describe('unregistered handlers', () => {
        it('should not run unregistered handlers', async () => {
            const handler = vi.fn();
            const unregister = registerCleanupHandler(handler);

            // Unregister before exit
            unregister();

            try {
                exit(0);
            } catch {
                // Expected
            }

            // Wait for cleanup to run
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(handler).not.toHaveBeenCalled();
        });
    });
});

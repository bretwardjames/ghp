/**
 * Centralized exit handling with cleanup support.
 *
 * Provides a way to register cleanup handlers that run before process.exit().
 * This ensures resources like child processes, intervals, and file handles
 * are properly cleaned up.
 */

import chalk from 'chalk';

type CleanupHandler = () => void | Promise<void>;

/** Valid exit codes for CLI (0 = success, 1 = error) */
export type ExitCode = 0 | 1;

const cleanupHandlers: CleanupHandler[] = [];
let isExiting = false;

/**
 * Register a cleanup handler to run before process exit.
 * Handlers are called in reverse order (LIFO - last registered runs first).
 *
 * @param handler - Function to call during cleanup (can be async)
 * @returns A function to unregister the handler
 * @throws Error if called while process is already exiting
 */
export function registerCleanupHandler(handler: CleanupHandler): () => void {
    if (isExiting) {
        // Fail fast - registering during exit is likely a bug
        throw new Error('Cannot register cleanup handler: process is exiting');
    }

    cleanupHandlers.push(handler);
    return () => {
        const index = cleanupHandlers.indexOf(handler);
        if (index !== -1) {
            cleanupHandlers.splice(index, 1);
        }
    };
}

/**
 * Run all cleanup handlers with a timeout.
 * @param timeoutMs - Maximum time to wait for all handlers (default: 5000ms)
 * @returns Object indicating whether cleanup completed or timed out
 */
async function runCleanupHandlers(timeoutMs = 5000): Promise<{ timedOut: boolean; completed: number; total: number }> {
    const total = cleanupHandlers.length;
    if (total === 0) {
        return { timedOut: false, completed: 0, total: 0 };
    }

    let timedOut = false;
    let completed = 0;
    let timeoutId: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<void>((resolve) => {
        timeoutId = setTimeout(() => {
            timedOut = true;
            resolve();
        }, timeoutMs);
    });

    const cleanupPromise = (async () => {
        // Snapshot handlers - any handlers registered during cleanup will not run
        const handlers = [...cleanupHandlers].reverse();

        for (const handler of handlers) {
            if (timedOut) {
                // Stop processing if timeout already fired
                break;
            }
            try {
                await handler();
                completed++;
            } catch (error) {
                // Log cleanup errors - they indicate resource management issues
                const handlerName = handler.name || 'anonymous';
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(
                    chalk.yellow('Warning:'),
                    `Cleanup handler '${handlerName}' failed:`,
                    errorMessage
                );
                completed++; // Count as processed even if failed
            }
        }
    })();

    await Promise.race([cleanupPromise, timeoutPromise]);

    // Clear the timeout to prevent timer leak
    if (timeoutId) {
        clearTimeout(timeoutId);
    }

    return { timedOut, completed, total };
}

/**
 * Exit the process after running all registered cleanup handlers.
 *
 * This function throws an error to immediately stop execution at the call site,
 * while cleanup handlers run asynchronously. The process will exit once cleanup
 * completes (or times out after 5 seconds).
 *
 * @param code - Exit code (0 for success, 1 for error)
 * @throws ExitPendingError - Always throws to stop execution at call site
 */
export function exit(code: ExitCode): never {
    if (isExiting) {
        // Recursive exit detected - this indicates a bug (e.g., cleanup handler calling exit)
        console.error(
            chalk.yellow('Warning:'),
            'Recursive exit() call detected - exiting immediately',
            chalk.dim(`(requested code: ${code})`)
        );
        process.exit(code);
    }
    isExiting = true;

    // Run cleanup handlers then exit
    runCleanupHandlers()
        .then(({ timedOut, completed, total }) => {
            if (timedOut) {
                console.error(
                    chalk.yellow('Warning:'),
                    `Cleanup timed out after 5s`,
                    chalk.dim(`(${completed}/${total} handlers completed)`)
                );
            }
        })
        .catch((error) => {
            // Log unexpected orchestration errors
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(
                chalk.yellow('Warning:'),
                'Cleanup orchestration failed:',
                errorMessage
            );
        })
        .finally(() => {
            process.exit(code);
        });

    // Throw to immediately stop execution at the call site.
    // The cleanup handlers run asynchronously above, and process.exit()
    // will be called in the finally block once they complete.
    throw new ExitPendingError(code);
}

/**
 * Error thrown by exit() to stop execution at the call site.
 * This can be caught and identified if needed.
 */
export class ExitPendingError extends Error {
    public readonly exitCode: ExitCode;

    constructor(code: ExitCode) {
        super('Process exit pending');
        this.name = 'ExitPendingError';
        this.exitCode = code;
    }
}

/**
 * Check if the process is currently exiting.
 */
export function isProcessExiting(): boolean {
    return isExiting;
}

/**
 * Reset exit state (for testing only).
 * @internal
 */
export function _resetForTesting(): void {
    isExiting = false;
    cleanupHandlers.length = 0;
}

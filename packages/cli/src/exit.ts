/**
 * Centralized exit handling with cleanup support.
 *
 * Provides a way to register cleanup handlers that run before process.exit().
 * This ensures resources like child processes, intervals, and file handles
 * are properly cleaned up.
 */

type CleanupHandler = () => void | Promise<void>;

const cleanupHandlers: CleanupHandler[] = [];
let isExiting = false;

/**
 * Register a cleanup handler to run before process exit.
 * Handlers are called in reverse order (LIFO - last registered runs first).
 *
 * @param handler - Function to call during cleanup (can be async)
 * @returns A function to unregister the handler
 */
export function registerCleanupHandler(handler: CleanupHandler): () => void {
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
 */
async function runCleanupHandlers(timeoutMs = 5000): Promise<void> {
    if (cleanupHandlers.length === 0) return;

    const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
            resolve();
        }, timeoutMs);
    });

    const cleanupPromise = (async () => {
        // Run handlers in reverse order (LIFO)
        const handlers = [...cleanupHandlers].reverse();
        for (const handler of handlers) {
            try {
                await handler();
            } catch {
                // Silently ignore cleanup errors - we're exiting anyway
            }
        }
    })();

    await Promise.race([cleanupPromise, timeoutPromise]);
}

/**
 * Exit the process after running all registered cleanup handlers.
 *
 * @param code - Exit code (0 for success, non-zero for error)
 */
export function exit(code: number): never {
    if (isExiting) {
        // Prevent recursive exit calls
        process.exit(code);
    }
    isExiting = true;

    // Run cleanup handlers then exit
    runCleanupHandlers()
        .finally(() => {
            process.exit(code);
        });

    // This line is never reached, but TypeScript needs it for the 'never' return type
    // The process.exit() in the finally block will terminate the process
    throw new Error('Process exit pending');
}

/**
 * Check if the process is currently exiting.
 */
export function isProcessExiting(): boolean {
    return isExiting;
}

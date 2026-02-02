/**
 * Event Hook Executor - Runs hooks with template variable substitution
 */

import { spawn } from 'child_process';
import * as readline from 'readline';
import type { EventHook, EventType, EventPayload, HookResult, HookOutcome, HookExitCodes } from './types.js';
import { getHooksForEvent } from './registry.js';

// =============================================================================
// Template Variable Substitution
// =============================================================================

/**
 * Escape a string for safe use in shell commands.
 * Wraps the string in single quotes and escapes any embedded single quotes.
 * This prevents shell injection attacks from issue titles, bodies, etc.
 */
function shellEscape(str: string): string {
    // Single-quote the string and escape embedded single quotes
    // 'foo'bar' becomes 'foo'\''bar'
    return "'" + str.replace(/'/g, "'\\''") + "'";
}

/**
 * Substitute template variables in a command string
 *
 * Supported variables:
 * - ${issue.number} - Issue number
 * - ${issue.json} - Full issue JSON (shell-escaped)
 * - ${issue.title} - Issue title
 * - ${issue.body} - Issue body
 * - ${branch} - Branch name
 * - ${pr.number} - PR number
 * - ${pr.json} - Full PR JSON (shell-escaped)
 * - ${pr.title} - PR title
 * - ${repo} - Repository in owner/name format
 * - ${worktree.path} - Absolute path to worktree
 * - ${worktree.name} - Directory name of worktree
 */
export function substituteTemplateVariables(command: string, payload: EventPayload): string {
    let result = command;

    // Repository
    result = result.replace(/\$\{repo\}/g, shellEscape(payload.repo));

    // Issue variables
    if ('issue' in payload && payload.issue) {
        result = result.replace(/\$\{issue\.number\}/g, String(payload.issue.number));
        result = result.replace(/\$\{issue\.title\}/g, shellEscape(payload.issue.title || ''));
        result = result.replace(/\$\{issue\.body\}/g, shellEscape(payload.issue.body || ''));
        result = result.replace(/\$\{issue\.url\}/g, shellEscape(payload.issue.url || ''));
        result = result.replace(/\$\{issue\.json\}/g, shellEscape(JSON.stringify(payload.issue)));
    }

    // Branch variable
    if ('branch' in payload && payload.branch) {
        result = result.replace(/\$\{branch\}/g, shellEscape(payload.branch));
    }

    // PR variables
    if ('pr' in payload && payload.pr) {
        result = result.replace(/\$\{pr\.number\}/g, String(payload.pr.number));
        result = result.replace(/\$\{pr\.title\}/g, shellEscape(payload.pr.title || ''));
        result = result.replace(/\$\{pr\.body\}/g, shellEscape((payload.pr as { body?: string }).body || ''));
        result = result.replace(/\$\{pr\.url\}/g, shellEscape(payload.pr.url || ''));
        result = result.replace(/\$\{pr\.merged_at\}/g, shellEscape((payload.pr as { merged_at?: string }).merged_at || ''));
        result = result.replace(/\$\{pr\.json\}/g, shellEscape(JSON.stringify(payload.pr)));
    }

    // Base branch variable (for pr-merged event)
    if ('base' in payload && payload.base) {
        result = result.replace(/\$\{base\}/g, shellEscape(payload.base));
    }

    // Worktree variables
    if ('worktree' in payload && payload.worktree) {
        result = result.replace(/\$\{worktree\.path\}/g, shellEscape(payload.worktree.path));
        result = result.replace(/\$\{worktree\.name\}/g, shellEscape(payload.worktree.name));
    }

    return result;
}

// =============================================================================
// Hook Execution Options
// =============================================================================

/**
 * Options for hook execution
 */
export interface HookExecutionOptions {
    /**
     * Working directory for hook execution.
     * If not specified, uses the current working directory.
     * Use this to run hooks from inside a worktree so plugins create files
     * in the correct location.
     */
    cwd?: string;
}

// =============================================================================
// Exit Code Classification
// =============================================================================

/**
 * Default exit code classification
 */
const DEFAULT_EXIT_CODES: Required<HookExitCodes> = {
    success: [0],
    abort: [1],
    warn: [],
};

/**
 * Determine the outcome of a hook based on its exit code and configuration
 */
function classifyExitCode(exitCode: number | null, exitCodes?: HookExitCodes): HookOutcome {
    const codes = { ...DEFAULT_EXIT_CODES, ...exitCodes };

    // Null exit code means killed by signal - treat as abort
    if (exitCode === null) {
        return 'abort';
    }

    if (codes.success.includes(exitCode)) {
        return 'success';
    }
    if (codes.warn.includes(exitCode)) {
        return 'warn';
    }
    if (codes.abort.includes(exitCode)) {
        return 'abort';
    }

    // Unclassified exit codes default to abort (exitCode 0 already matched above)
    return 'abort';
}

// =============================================================================
// Interactive Mode Support
// =============================================================================

/**
 * Format hook output for display in a box
 */
function formatOutputBox(hookName: string, output: string, maxLines = 10): string {
    const lines = output.split('\n');
    const truncated = lines.length > maxLines;
    const displayLines = truncated ? lines.slice(0, maxLines) : lines;

    const width = 60;
    const topBorder = `┌─ ${hookName} ${'─'.repeat(Math.max(0, width - hookName.length - 4))}┐`;
    const bottomBorder = `└${'─'.repeat(width)}┘`;

    const formattedLines = displayLines.map((line) => {
        const truncatedLine = line.length > width - 4 ? line.slice(0, width - 7) + '...' : line;
        return `│ ${truncatedLine.padEnd(width - 2)} │`;
    });

    if (truncated) {
        formattedLines.push(`│ ${'... (truncated)'.padEnd(width - 2)} │`);
    }

    return [topBorder, ...formattedLines, bottomBorder].join('\n');
}

/**
 * Prompt user for interactive mode decision
 * Returns: 'continue' | 'abort' | 'view'
 */
async function promptUser(prompt: string): Promise<'continue' | 'abort' | 'view'> {
    // Safe default for non-interactive contexts (piped input, scripts)
    if (!process.stdin.isTTY) {
        return 'abort';
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question(`${prompt} (y/N/v) `, (answer) => {
            rl.close();
            const normalized = answer.trim().toLowerCase();
            if (normalized === 'y' || normalized === 'yes') {
                resolve('continue');
            } else if (normalized === 'v' || normalized === 'view') {
                resolve('view');
            } else {
                resolve('abort');
            }
        });
    });
}

/**
 * Display full output in $PAGER or fallback to console
 */
async function showInPager(output: string): Promise<void> {
    const pager = process.env.PAGER || 'less';

    return new Promise((resolve) => {
        const child = spawn(pager, [], {
            stdio: ['pipe', 'inherit', 'inherit'],
        });

        child.stdin?.write(output);
        child.stdin?.end();

        child.on('close', () => resolve());
        child.on('error', () => {
            // Fallback: just print to console
            console.log(output);
            resolve();
        });
    });
}

// =============================================================================
// Hook Execution
// =============================================================================

/**
 * Execute a shell command and return stdout, stderr, and exit code
 */
async function runCommand(
    command: string,
    timeout: number,
    cwd?: string
): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
    return new Promise((resolve) => {
        const child = spawn('/bin/sh', ['-c', command], {
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd,
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
        }, timeout);

        child.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                exitCode: code,
                timedOut,
            });
        });

        child.on('error', (err) => {
            clearTimeout(timer);
            resolve({
                stdout: '',
                stderr: err.message,
                exitCode: null,
                timedOut: false,
            });
        });
    });
}

/**
 * Execute a single event hook with mode-specific behavior
 *
 * @param hook - The hook to execute
 * @param payload - Event payload with template variables
 * @param options - Execution options (e.g., working directory)
 */
export async function executeEventHook(
    hook: EventHook,
    payload: EventPayload,
    options: HookExecutionOptions = {}
): Promise<HookResult> {
    const startTime = Date.now();
    const mode = hook.mode || 'fire-and-forget';

    // Substitute template variables
    const command = substituteTemplateVariables(hook.command, payload);

    // Run the command
    const { stdout, stderr, exitCode, timedOut } = await runCommand(
        command,
        hook.timeout || 30000,
        options.cwd
    );

    const duration = Date.now() - startTime;

    // Determine outcome based on exit code
    const outcome = timedOut ? 'abort' : classifyExitCode(exitCode, hook.exitCodes);
    const success = outcome === 'success' || outcome === 'warn';

    // Build base result
    const result: HookResult = {
        hookName: hook.name,
        success,
        output: stdout,
        stderr,
        duration,
        exitCode,
        mode,
        outcome,
        aborted: false,
    };

    // Handle timeout
    if (timedOut) {
        result.error = `Hook timed out after ${hook.timeout || 30000}ms`;
        result.outcome = 'abort';
        result.success = false;
    }

    // Mode-specific behavior
    switch (mode) {
        case 'fire-and-forget':
            // Silent - just return the result, never abort
            result.aborted = false;
            break;

        case 'blocking':
            // Show output on failure, abort on non-success
            if (!success) {
                console.error(formatOutputBox(hook.displayName || hook.name, stderr || stdout));
                result.aborted = true;
            }
            break;

        case 'interactive': {
            // Always show output, prompt user
            const displayOutput = stderr || stdout || '(no output)';
            console.log(formatOutputBox(hook.displayName || hook.name, displayOutput));

            const promptText = hook.continuePrompt || 'Continue?';
            let decision = await promptUser(promptText);

            // Handle view option - show in pager then re-prompt
            while (decision === 'view') {
                await showInPager(stderr || stdout || '(no output)');
                decision = await promptUser(promptText);
            }

            result.aborted = decision === 'abort';
            result.outcome = decision === 'continue' ? 'continue' : 'abort';
            break;
        }
    }

    return result;
}

/**
 * Execute all hooks for a given event
 *
 * Returns results for each hook that was executed.
 * Hooks are executed sequentially (not in parallel) to avoid race conditions.
 *
 * If a hook with blocking or interactive mode signals abort, execution stops
 * and the aborted result is included. Check result.aborted on the last item
 * to determine if the workflow should be aborted.
 *
 * @param event - The event type to fire hooks for
 * @param payload - Event payload with template variables
 * @param options - Execution options (e.g., working directory)
 */
export async function executeHooksForEvent(
    event: EventType,
    payload: EventPayload,
    options: HookExecutionOptions = {}
): Promise<HookResult[]> {
    const hooks = getHooksForEvent(event);
    const results: HookResult[] = [];

    for (const hook of hooks) {
        const result = await executeEventHook(hook, payload, options);
        results.push(result);

        // Stop processing if a hook signals abort
        if (result.aborted) {
            break;
        }
    }

    return results;
}

/**
 * Check if hook results indicate the workflow should abort
 */
export function shouldAbort(results: HookResult[]): boolean {
    return results.some((r) => r.aborted);
}

/**
 * Check if any hooks are registered for an event
 */
export function hasHooksForEvent(event: EventType): boolean {
    return getHooksForEvent(event).length > 0;
}

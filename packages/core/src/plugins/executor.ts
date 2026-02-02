/**
 * Event Hook Executor - Runs hooks with template variable substitution
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { EventHook, EventType, EventPayload, HookResult } from './types.js';
import { getHooksForEvent } from './registry.js';

const execAsync = promisify(exec);

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
// Hook Execution
// =============================================================================

/**
 * Execute a single event hook
 */
export async function executeEventHook(
    hook: EventHook,
    payload: EventPayload
): Promise<HookResult> {
    const startTime = Date.now();

    try {
        // Substitute template variables
        const command = substituteTemplateVariables(hook.command, payload);

        // Use sh as the shell for maximum portability
        // /bin/sh exists on all POSIX systems including minimal containers
        const { stdout } = await execAsync(command, {
            timeout: hook.timeout || 30000,
            shell: '/bin/sh',
        });

        return {
            hookName: hook.name,
            success: true,
            output: stdout.trim(),
            duration: Date.now() - startTime,
        };
    } catch (error) {
        const err = error as { stderr?: string; message?: string; killed?: boolean };
        const errorMessage = err.killed
            ? `Hook timed out after ${hook.timeout || 30000}ms`
            : err.stderr || err.message || 'Hook execution failed';

        return {
            hookName: hook.name,
            success: false,
            error: errorMessage,
            duration: Date.now() - startTime,
        };
    }
}

/**
 * Execute all hooks for a given event
 *
 * Returns results for each hook that was executed.
 * Hooks are executed sequentially (not in parallel) to avoid race conditions.
 */
export async function executeHooksForEvent(
    event: EventType,
    payload: EventPayload
): Promise<HookResult[]> {
    const hooks = getHooksForEvent(event);
    const results: HookResult[] = [];

    for (const hook of hooks) {
        const result = await executeEventHook(hook, payload);
        results.push(result);
    }

    return results;
}

/**
 * Check if any hooks are registered for an event
 */
export function hasHooksForEvent(event: EventType): boolean {
    return getHooksForEvent(event).length > 0;
}

/**
 * Unified Claude Runner
 *
 * Handles authentication flow with graceful fallbacks:
 * 1. Check ANTHROPIC_API_KEY env var
 * 2. Check ghp config for claude.auth setting ('api' | 'cli')
 * 3. If no explicit setting, check for API key in config
 * 4. If API key found, use direct API
 * 5. If no API key, try Claude CLI (non-interactive mode)
 * 6. If all fail, offer manual fallback
 */

import chalk from 'chalk';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { getClaudeConfig, type ResolvedClaudeConfig } from './config.js';
import { ClaudeClient } from '@bretwardjames/ghp-core';
import { isInteractive } from './prompts.js';
import { createInterface } from 'readline';

const execAsync = promisify(exec);

export type AuthMethod = 'api' | 'cli' | 'none';

export interface ClaudeRunnerResult {
    /** Whether the operation succeeded */
    success: boolean;
    /** The generated content (if successful) */
    content?: string;
    /** Error message (if failed) */
    error?: string;
    /** Which auth method was used */
    authMethod: AuthMethod;
}

export interface ClaudeRunnerOptions {
    /** The prompt/task to send to Claude */
    prompt: string;
    /** System prompt (context) */
    systemPrompt?: string;
    /** Content type for display (e.g., "PR description") */
    contentType: string;
    /** Callback for streaming output (API mode only) */
    onToken?: (token: string) => void;
}

/**
 * Check if Claude CLI is available
 */
async function isClaudeCliAvailable(): Promise<boolean> {
    try {
        await execAsync('which claude');
        return true;
    } catch {
        return false;
    }
}

/**
 * Run prompt via Claude CLI (non-interactive mode)
 */
async function runViaCli(prompt: string, systemPrompt?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const args = ['--print', '--output-format', 'text'];

        if (systemPrompt) {
            args.push('--system-prompt', systemPrompt);
        }

        const child = spawn('claude', args, {
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.stdin.write(prompt);
        child.stdin.end();

        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout.trim());
            } else {
                reject(new Error(stderr || `Claude CLI exited with code ${code}`));
            }
        });

        child.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Prompt user for a choice
 */
function promptChoice(question: string): Promise<string> {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase());
        });
    });
}

/**
 * Determine which auth method to use based on config and availability
 */
async function determineAuthMethod(config: ResolvedClaudeConfig): Promise<{
    method: AuthMethod;
    client?: ClaudeClient;
    reason?: string;
}> {
    // 1. If explicit auth mode is set, use it
    if (config.authMode === 'api') {
        if (config.apiKey) {
            return {
                method: 'api',
                client: new ClaudeClient({
                    apiKey: config.apiKey,
                    model: config.model,
                    maxTokens: config.maxTokens,
                }),
            };
        }
        return {
            method: 'none',
            reason: 'Auth mode set to "api" but no API key found. Set ANTHROPIC_API_KEY or ghp config claude.apiKey',
        };
    }

    if (config.authMode === 'cli') {
        if (await isClaudeCliAvailable()) {
            return { method: 'cli' };
        }
        return {
            method: 'none',
            reason: 'Auth mode set to "cli" but Claude CLI not found. Install Claude Code first.',
        };
    }

    // 2. No explicit setting - try API key first
    if (config.apiKey) {
        return {
            method: 'api',
            client: new ClaudeClient({
                apiKey: config.apiKey,
                model: config.model,
                maxTokens: config.maxTokens,
            }),
        };
    }

    // 3. No API key - try Claude CLI
    if (await isClaudeCliAvailable()) {
        return { method: 'cli' };
    }

    // 4. Nothing available
    return {
        method: 'none',
        reason: 'No authentication available',
    };
}

/**
 * Run a prompt through Claude with automatic auth fallback
 */
export async function runClaude(options: ClaudeRunnerOptions): Promise<ClaudeRunnerResult> {
    const config = getClaudeConfig();
    const auth = await determineAuthMethod(config);

    if (auth.method === 'none') {
        // No auth available - offer fallback
        return handleNoAuth(options.contentType, auth.reason);
    }

    try {
        let content: string;

        if (auth.method === 'api' && auth.client) {
            // Use direct API
            console.log(chalk.dim(`Using Anthropic API (${config.model})...`));

            const result = await auth.client.complete({
                system: options.systemPrompt,
                messages: [{ role: 'user', content: options.prompt }],
            });

            content = result.text;
        } else {
            // Use Claude CLI
            console.log(chalk.dim('Using Claude Code CLI...'));

            content = await runViaCli(options.prompt, options.systemPrompt);
        }

        return {
            success: true,
            content,
            authMethod: auth.method,
        };

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';

        // If API fails, try CLI as fallback (unless CLI was already tried)
        if (auth.method === 'api' && await isClaudeCliAvailable()) {
            console.log(chalk.yellow('API call failed, trying Claude CLI...'));
            try {
                const content = await runViaCli(options.prompt, options.systemPrompt);
                return {
                    success: true,
                    content,
                    authMethod: 'cli',
                };
            } catch (cliError) {
                // Both failed
                return handleNoAuth(options.contentType, `API error: ${errorMsg}`);
            }
        }

        return handleNoAuth(options.contentType, errorMsg);
    }
}

/**
 * Handle case where no auth is available - offer manual fallback
 */
async function handleNoAuth(
    contentType: string,
    reason?: string
): Promise<ClaudeRunnerResult> {
    console.log();
    console.log(chalk.yellow("Couldn't connect to Claude."));

    if (reason) {
        console.log(chalk.dim(reason));
    }

    console.log();
    console.log('To set up authentication:');
    console.log(`  ${chalk.cyan('Option 1:')} Set API key: ${chalk.dim('export ANTHROPIC_API_KEY=sk-ant-...')}`);
    console.log(`  ${chalk.cyan('Option 2:')} Configure ghp: ${chalk.dim('ghp config claude.apiKey sk-ant-...')}`);
    console.log(`  ${chalk.cyan('Option 3:')} Use Claude CLI: ${chalk.dim('ghp config claude.auth cli')}`);
    console.log();

    if (!isInteractive()) {
        return {
            success: false,
            error: 'No Claude authentication available in non-interactive mode',
            authMethod: 'none',
        };
    }

    const choice = await promptChoice(`Write ${contentType} manually? [y/N]: `);

    if (choice === 'y' || choice === 'yes') {
        return {
            success: false,
            error: 'User chose to write manually',
            authMethod: 'none',
        };
    }

    return {
        success: false,
        error: 'No authentication available',
        authMethod: 'none',
    };
}

/**
 * Generate content with Claude, with fallback to manual writing
 *
 * Returns the generated content, or null if user wants to write manually
 */
export async function generateWithClaude(options: ClaudeRunnerOptions): Promise<string | null> {
    const result = await runClaude(options);

    if (result.success && result.content) {
        return result.content;
    }

    // Check if user chose to write manually
    if (result.error === 'User chose to write manually') {
        return null; // Signal to open editor
    }

    // Other error - already displayed message
    return null;
}

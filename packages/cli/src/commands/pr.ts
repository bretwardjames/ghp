import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { api } from '../github-api.js';
import { detectRepository, getCurrentBranch, type RepoInfo } from '../git-utils.js';
import { getIssueForBranch } from '../branch-linker.js';
import { getConfig, getClaudeConfig, getHooksConfig } from '../config.js';
import { loadProjectConventions, buildConventionsContext } from '../conventions.js';
import { runFeedbackLoop, UserCancelledError } from '../ai-feedback.js';
import { generateWithClaude } from '../claude-runner.js';
import { openEditor } from '../editor.js';
import {
    ClaudeClient,
    claudePrompts,
    createPRWorkflow,
} from '@bretwardjames/ghp-core';
import { exit } from '../exit.js';

const execAsync = promisify(exec);

interface PrOptions {
    create?: boolean;
    open?: boolean;
    aiDescription?: boolean;
    force?: boolean;
    noHooks?: boolean;
}

export async function prCommand(issue: string | undefined, options: PrOptions): Promise<void> {
    // Detect repository
    const repo = await detectRepository();
    if (!repo) {
        console.error(chalk.red('Error:'), 'Not in a git repository with a GitHub remote');
        exit(1);
    }

    // Authenticate
    const authenticated = await api.authenticate();
    if (!authenticated) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run', chalk.cyan('ghp auth'));
        exit(1);
    }

    const currentBranch = await getCurrentBranch();
    if (!currentBranch) {
        console.error(chalk.red('Error:'), 'Could not determine current branch');
        exit(1);
    }

    // If issue not specified, try to find linked issue for current branch
    let issueNumber: number | null = null;
    let linkedIssue = await getIssueForBranch(repo, currentBranch);

    if (issue) {
        issueNumber = parseInt(issue, 10);
        if (isNaN(issueNumber)) {
            console.error(chalk.red('Error:'), 'Issue must be a number');
            exit(1);
        }
    } else if (linkedIssue) {
        issueNumber = linkedIssue.issueNumber;
        console.log(chalk.dim(`Using linked issue #${issueNumber}: ${linkedIssue.issueTitle}`));
    }

    if (options.create) {
        await createPr(repo, currentBranch, issueNumber, linkedIssue?.issueTitle, options);
    } else if (options.open) {
        await openPr();
    } else {
        // Default: show PR status
        await showPrStatus(issueNumber);
    }
}

async function createPr(
    repo: RepoInfo,
    currentBranch: string,
    issueNumber: number | null,
    issueTitle: string | undefined,
    options: PrOptions
): Promise<void> {
    const { aiDescription: useAiDescription, force, noHooks } = options;

    try {
        // Build title from issue if available
        let title = '';
        let body = '';

        if (issueNumber && issueTitle) {
            title = issueTitle;
            body = `Relates to #${issueNumber}`;
        }

        // Generate AI description if requested
        if (useAiDescription) {
            const aiBody = await generateAiDescription(issueNumber, issueTitle);
            if (aiBody) {
                body = aiBody;
            }
        }

        console.log(chalk.dim('Creating PR...'));

        // Use the workflow to handle PR creation and all hooks
        const baseBranch = getConfig('mainBranch') || 'main';
        const hooksConfig = getHooksConfig();

        const result = await createPRWorkflow({
            repo,
            title: title || currentBranch, // Fall back to branch name if no title
            body,
            baseBranch,
            headBranch: currentBranch,
            issueNumber: issueNumber ?? undefined,
            issueTitle,
            openInBrowser: false, // We'll handle browser opening ourselves
            skipHooks: noHooks,
            force,
            onFailure: hooksConfig.onFailure,
        });

        // Handle abort by hook
        if (result.abortedByHook) {
            console.error(
                chalk.red('PR creation aborted by'),
                chalk.yellow(result.abortedAtEvent),
                chalk.red('hook:'),
                chalk.cyan(result.abortedByHook)
            );
            if (force) {
                console.log(chalk.dim('Use --force to bypass blocking hooks.'));
            }
            exit(1);
        }

        // Handle other errors
        if (!result.success) {
            if (result.error?.includes('already exists')) {
                console.log(chalk.yellow('PR already exists for this branch.'));
                await openPr();
                return;
            }
            console.error(chalk.red('Error creating PR:'), result.error);
            exit(1);
        }

        // Success!
        console.log(chalk.green('Created PR:'), result.pr?.url);

        // Log hook results
        if (result.hookResults.length > 0) {
            console.log();
            for (const hookResult of result.hookResults) {
                if (hookResult.success) {
                    console.log(chalk.green('✓'), `Hook "${hookResult.hookName}" completed`);
                    if (hookResult.output) {
                        const lines = hookResult.output.split('\n').slice(0, 3);
                        for (const line of lines) {
                            console.log(chalk.dim(`  ${line}`));
                        }
                        if (hookResult.output.split('\n').length > 3) {
                            console.log(chalk.dim('  ...'));
                        }
                    }
                } else if (!hookResult.aborted) {
                    // Only show failed hooks that didn't abort (fire-and-forget failures)
                    console.log(chalk.yellow('⚠'), `Hook "${hookResult.hookName}" failed`);
                    if (hookResult.error) {
                        console.log(chalk.dim(`  ${hookResult.error}`));
                    }
                }
            }
        }

        // Open PR in browser
        if (result.pr?.url) {
            console.log();
            console.log(chalk.dim('Opening in browser...'));
            await execAsync('gh pr view --web');
        }
    } catch (error: unknown) {
        const err = error as { stderr?: string; message?: string };
        console.error(chalk.red('Error creating PR:'), err.stderr || err.message || error);
        exit(1);
    }
}

/**
 * Generate PR description using AI with feedback loop
 */
async function generateAiDescription(
    issueNumber: number | null,
    issueTitle: string | undefined
): Promise<string | null> {
    // Get the diff
    console.log(chalk.dim('Getting diff...'));
    let diff: string;
    try {
        const mainBranch = getConfig('mainBranch') || 'main';
        const { stdout } = await execAsync(`git diff ${mainBranch}...HEAD`);
        diff = stdout;
    } catch {
        try {
            const { stdout } = await execAsync('git diff HEAD~10...HEAD');
            diff = stdout;
        } catch {
            console.error(chalk.red('Error:'), 'Could not get diff');
            return null;
        }
    }

    if (!diff.trim()) {
        console.log(chalk.yellow('No changes to describe.'));
        return null;
    }

    // Get commit messages
    let commits: string[] = [];
    try {
        const mainBranch = getConfig('mainBranch') || 'main';
        const { stdout } = await execAsync(`git log ${mainBranch}..HEAD --oneline`);
        commits = stdout.trim().split('\n').filter(Boolean);
    } catch {
        // Ignore - commits are optional
    }

    // Load project conventions
    const conventions = loadProjectConventions();
    const conventionsContext = buildConventionsContext(conventions);

    // Build prompts
    const systemPrompt = claudePrompts.buildPRDescriptionSystemPrompt(conventionsContext);
    const userPrompt = claudePrompts.buildPRDescriptionUserPrompt({
        diff,
        issue: issueNumber && issueTitle ? {
            number: issueNumber,
            title: issueTitle,
            body: '',
        } : undefined,
        commits,
    });

    console.log(chalk.dim('Generating PR description...'));
    console.log();

    // Try to generate with Claude (handles auth fallback)
    const initialContent = await generateWithClaude({
        prompt: userPrompt,
        systemPrompt,
        contentType: 'PR description',
    });

    // If null, user chose to write manually
    if (initialContent === null) {
        console.log(chalk.dim('Opening editor for manual PR description...'));

        const template = `## Summary
<!-- Describe what this PR does -->

## Changes
<!-- List the key changes -->
-

## Notes
<!-- Any additional notes, breaking changes, or migration steps -->

${issueNumber ? `Relates to #${issueNumber}` : ''}
`;

        try {
            return await openEditor(template, '.md');
        } catch (err) {
            console.error(chalk.red('Error:'), 'Editor failed');
            return null;
        }
    }

    // Get Claude config for regeneration
    const claudeConfig = getClaudeConfig();

    // Run feedback loop
    const result = await runFeedbackLoop({
        contentType: 'PR description',
        initialContent,
        regenerate: async (feedback: string) => {
            console.log(chalk.dim('Regenerating...'));

            // For regeneration, we need a Claude client
            if (!claudeConfig.apiKey) {
                // Fall back to CLI regeneration
                const feedbackPrompt = userPrompt + `\n\n## User Feedback\nPlease regenerate taking this feedback into account:\n${feedback}`;
                const result = await generateWithClaude({
                    prompt: feedbackPrompt,
                    systemPrompt,
                    contentType: 'PR description',
                });
                return result || initialContent;
            }

            const claude = new ClaudeClient({
                apiKey: claudeConfig.apiKey,
                model: claudeConfig.model,
                maxTokens: claudeConfig.maxTokens,
            });

            return await claude.generatePRDescription({
                diff,
                issue: issueNumber && issueTitle ? {
                    number: issueNumber,
                    title: issueTitle,
                    body: '',
                } : undefined,
                commits,
                conventions: conventionsContext,
                feedback,
            });
        },
    });

    return result.content;
}

async function openPr(): Promise<void> {
    try {
        await execAsync('gh pr view --web');
    } catch {
        console.error(chalk.red('Error:'), 'No PR found for current branch');
        exit(1);
    }
}

async function showPrStatus(issueNumber: number | null): Promise<void> {
    try {
        const { stdout } = await execAsync('gh pr status');
        console.log(stdout);
    } catch (error: unknown) {
        const err = error as { stderr?: string };
        console.error(chalk.red('Error:'), err.stderr || 'Failed to get PR status');
        exit(1);
    }
}

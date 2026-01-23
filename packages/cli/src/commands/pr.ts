import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { api } from '../github-api.js';
import { detectRepository, getCurrentBranch } from '../git-utils.js';
import { getIssueForBranch } from '../branch-linker.js';
import { getConfig, getClaudeConfig } from '../config.js';
import { loadProjectConventions, buildConventionsContext } from '../conventions.js';
import { runFeedbackLoop, UserCancelledError } from '../ai-feedback.js';
import { generateWithClaude } from '../claude-runner.js';
import { openEditor } from '../editor.js';
import { ClaudeClient, claudePrompts } from '@bretwardjames/ghp-core';

const execAsync = promisify(exec);

interface PrOptions {
    create?: boolean;
    open?: boolean;
    aiDescription?: boolean;
}

export async function prCommand(issue: string | undefined, options: PrOptions): Promise<void> {
    // Detect repository
    const repo = await detectRepository();
    if (!repo) {
        console.error(chalk.red('Error:'), 'Not in a git repository with a GitHub remote');
        process.exit(1);
    }

    // Authenticate
    const authenticated = await api.authenticate();
    if (!authenticated) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run', chalk.cyan('ghp auth'));
        process.exit(1);
    }

    const currentBranch = await getCurrentBranch();
    if (!currentBranch) {
        console.error(chalk.red('Error:'), 'Could not determine current branch');
        process.exit(1);
    }

    // If issue not specified, try to find linked issue for current branch
    let issueNumber: number | null = null;
    let linkedIssue = await getIssueForBranch(repo, currentBranch);

    if (issue) {
        issueNumber = parseInt(issue, 10);
        if (isNaN(issueNumber)) {
            console.error(chalk.red('Error:'), 'Issue must be a number');
            process.exit(1);
        }
    } else if (linkedIssue) {
        issueNumber = linkedIssue.issueNumber;
        console.log(chalk.dim(`Using linked issue #${issueNumber}: ${linkedIssue.issueTitle}`));
    }

    if (options.create) {
        await createPr(repo.fullName, issueNumber, linkedIssue?.issueTitle, options.aiDescription);
    } else if (options.open) {
        await openPr();
    } else {
        // Default: show PR status
        await showPrStatus(issueNumber);
    }
}

async function createPr(
    repoFullName: string,
    issueNumber: number | null,
    issueTitle: string | undefined,
    useAiDescription?: boolean
): Promise<void> {
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

        // Use gh CLI to create PR
        // Escape shell special characters in title
        const escapeShell = (str: string) => str.replace(/([`$\\"])/g, '\\$1');
        const titleArg = title ? `--title "${escapeShell(title)}"` : '';
        // Use heredoc for body to handle multi-line content safely
        const bodyArg = body ? `--body "$(cat <<'EOF'\n${body}\nEOF\n)"` : '';

        console.log(chalk.dim('Creating PR...'));

        const { stdout } = await execAsync(`gh pr create ${titleArg} ${bodyArg} --web`);
        console.log(stdout);

        // Update issue status if configured
        if (issueNumber) {
            const prOpenedStatus = getConfig('startWorkingStatus'); // TODO: add prOpenedStatus to config
            // Could update status here
        }
    } catch (error: unknown) {
        const err = error as { stderr?: string };
        if (err.stderr?.includes('already exists')) {
            console.log(chalk.yellow('PR already exists for this branch.'));
            await openPr();
        } else {
            console.error(chalk.red('Error creating PR:'), err.stderr || error);
            process.exit(1);
        }
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
        process.exit(1);
    }
}

async function showPrStatus(issueNumber: number | null): Promise<void> {
    try {
        const { stdout } = await execAsync('gh pr status');
        console.log(stdout);
    } catch (error: unknown) {
        const err = error as { stderr?: string };
        console.error(chalk.red('Error:'), err.stderr || 'Failed to get PR status');
        process.exit(1);
    }
}

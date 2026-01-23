/**
 * AI Feedback Loop UI
 *
 * Provides a reusable feedback mechanism for AI-generated content.
 * Users can accept, edit, or regenerate with feedback.
 */

import chalk from 'chalk';
import { createInterface } from 'readline';
import { isInteractive } from './prompts.js';
import { openEditor } from './editor.js';

/** Error thrown when user cancels the feedback loop */
export class UserCancelledError extends Error {
    constructor() {
        super('User cancelled');
        this.name = 'UserCancelledError';
    }
}

export interface FeedbackResult {
    /** The final accepted content */
    content: string;
    /** Whether the user edited the content */
    wasEdited: boolean;
    /** Number of regeneration attempts */
    regenerationCount: number;
    /** Whether the user cancelled */
    cancelled?: boolean;
}

export interface FeedbackOptions {
    /** Type of content being generated (for display) */
    contentType: string;
    /** Initial generated content */
    initialContent: string;
    /** Function to regenerate content with feedback */
    regenerate: (feedback: string) => Promise<string>;
    /** File extension for editor (default: .md) */
    fileExtension?: string;
    /** Whether to show a preview (default: true) */
    showPreview?: boolean;
    /** Maximum regeneration attempts (default: 5) */
    maxRegenerations?: number;
}

/**
 * Prompt user for a single line of input
 */
function promptLine(question: string): Promise<string> {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

/**
 * Display content preview with line numbers
 */
function displayPreview(content: string, maxLines: number = 30): void {
    const lines = content.split('\n');
    const displayLines = lines.slice(0, maxLines);

    console.log();
    console.log(chalk.dim('─'.repeat(60)));
    for (const line of displayLines) {
        console.log(line);
    }
    if (lines.length > maxLines) {
        console.log(chalk.dim(`... (${lines.length - maxLines} more lines)`));
    }
    console.log(chalk.dim('─'.repeat(60)));
    console.log();
}

/**
 * Run the feedback loop for AI-generated content
 */
export async function runFeedbackLoop(options: FeedbackOptions): Promise<FeedbackResult> {
    const {
        contentType,
        initialContent,
        regenerate,
        fileExtension = '.md',
        showPreview = true,
        maxRegenerations = 5,
    } = options;

    let currentContent = initialContent;
    let regenerationCount = 0;
    let wasEdited = false;

    // Non-interactive mode: just return the initial content
    if (!isInteractive()) {
        return {
            content: currentContent,
            wasEdited: false,
            regenerationCount: 0,
        };
    }

    while (true) {
        // Show preview if enabled
        if (showPreview) {
            console.log(chalk.bold(`Generated ${contentType}:`));
            displayPreview(currentContent);
        }

        // Show options
        console.log('Options:');
        console.log(`  ${chalk.cyan('a')} - Accept and continue`);
        console.log(`  ${chalk.cyan('e')} - Edit in $EDITOR`);
        if (regenerationCount < maxRegenerations) {
            console.log(`  ${chalk.cyan('r')} - Regenerate with feedback`);
        }
        console.log(`  ${chalk.cyan('q')} - Cancel`);
        console.log();

        const choice = await promptLine('Choice [a/e/r/q]: ');

        switch (choice.toLowerCase()) {
            case 'a':
            case 'accept':
            case '':
                // Accept current content
                return {
                    content: currentContent,
                    wasEdited,
                    regenerationCount,
                };

            case 'e':
            case 'edit':
                // Edit in editor
                try {
                    const edited = await openEditor(currentContent, fileExtension);
                    if (edited.trim() !== currentContent.trim()) {
                        currentContent = edited;
                        wasEdited = true;
                        console.log(chalk.green('Content updated.'));
                    } else {
                        console.log(chalk.dim('No changes made.'));
                    }
                } catch (err) {
                    console.error(chalk.red('Error opening editor:'), err);
                }
                break;

            case 'r':
            case 'regenerate':
                if (regenerationCount >= maxRegenerations) {
                    console.log(chalk.yellow(`Maximum regenerations (${maxRegenerations}) reached.`));
                    break;
                }

                // Get feedback
                console.log();
                console.log(chalk.dim('What would you like to change? (or press Enter to regenerate without feedback)'));
                const feedback = await promptLine('Feedback: ');

                console.log();
                console.log(chalk.dim('Regenerating...'));

                try {
                    currentContent = await regenerate(feedback || 'Please try again with a different approach.');
                    regenerationCount++;
                    console.log(chalk.green('Regenerated.'));
                } catch (err) {
                    console.error(chalk.red('Error regenerating:'), err);
                }
                break;

            case 'q':
            case 'quit':
            case 'cancel':
                console.log(chalk.yellow('Cancelled.'));
                throw new UserCancelledError();

            default:
                console.log(chalk.yellow('Invalid choice. Please enter a, e, r, or q.'));
        }

        console.log();
    }
}

/**
 * Simple confirmation prompt
 */
export async function confirmContent(
    content: string,
    contentType: string
): Promise<boolean> {
    if (!isInteractive()) {
        return true;
    }

    console.log(chalk.bold(`Generated ${contentType}:`));
    displayPreview(content);

    const answer = await promptLine('Accept? [Y/n]: ');
    return answer.toLowerCase() !== 'n';
}

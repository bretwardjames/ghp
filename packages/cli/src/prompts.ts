/**
 * Interactive CLI prompts using built-in readline
 */
import * as readline from 'readline';
import chalk from 'chalk';

/**
 * Ask a simple yes/no question
 */
export function prompt(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

/**
 * Prompt user to select from a numbered list of options.
 * Returns the index of the selected option.
 */
export async function promptSelect(question: string, options: string[]): Promise<number> {
    console.log(question);
    options.forEach((opt, i) => {
        console.log(chalk.cyan(`  [${i + 1}]`), opt);
    });

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => {
        const askQuestion = () => {
            rl.question(chalk.dim('Enter number: '), answer => {
                const num = parseInt(answer, 10);
                if (num >= 1 && num <= options.length) {
                    rl.close();
                    resolve(num - 1);
                } else {
                    console.log(chalk.yellow(`Please enter a number between 1 and ${options.length}`));
                    askQuestion();
                }
            });
        };
        askQuestion();
    });
}

export interface SyncChoice {
    key: string;
    displayName: string;
    cliValue: string | undefined;
    vscodeValue: string | undefined;
}

/**
 * Prompt for resolving a sync conflict with options:
 * 1. Use CLI value
 * 2. Use VSCode value
 * 3. Enter custom value
 * 4. Skip (keep both as-is)
 *
 * Returns: 'cli' | 'vscode' | 'skip' | { custom: string }
 */
export async function promptSyncConflict(
    conflict: SyncChoice
): Promise<'cli' | 'vscode' | 'skip' | { custom: string }> {
    console.log();
    console.log(chalk.bold.yellow(`Conflict: ${conflict.displayName}`));
    console.log(`  CLI:    ${chalk.cyan(conflict.cliValue ?? '(not set)')}`);
    console.log(`  VSCode: ${chalk.magenta(conflict.vscodeValue ?? '(not set)')}`);

    const options = [
        `Use CLI value: ${chalk.cyan(conflict.cliValue ?? '(not set)')}`,
        `Use VSCode value: ${chalk.magenta(conflict.vscodeValue ?? '(not set)')}`,
        'Enter custom value',
        'Skip (keep both as-is)',
    ];

    const choice = await promptSelect('Which value do you want to use?', options);

    if (choice === 0) return 'cli';
    if (choice === 1) return 'vscode';
    if (choice === 3) return 'skip';

    // Custom value
    const customValue = await prompt(chalk.dim('Enter custom value: '));
    return { custom: customValue };
}

export interface UniqueSettingChoice {
    key: string;
    displayName: string;
    value: string;
    source: 'cli' | 'vscode';
}

/**
 * Prompt for syncing a setting that only exists in one source
 * Returns true to sync, false to skip
 */
export async function promptSyncUnique(setting: UniqueSettingChoice): Promise<boolean> {
    console.log();
    const sourceName = setting.source === 'cli' ? 'CLI' : 'VSCode';
    const targetName = setting.source === 'cli' ? 'VSCode' : 'CLI';
    const sourceColor = setting.source === 'cli' ? chalk.cyan : chalk.magenta;

    console.log(chalk.bold(`${setting.displayName}`));
    console.log(`  Only in ${sourceName}: ${sourceColor(setting.value)}`);

    const answer = await prompt(`Sync to ${targetName}? (Y/n) `);
    return answer !== 'n' && answer !== 'no';
}

/**
 * Prompt to confirm before applying changes
 */
export async function promptConfirm(message: string, defaultYes = true): Promise<boolean> {
    const hint = defaultYes ? '(Y/n)' : '(y/N)';
    const answer = await prompt(`${message} ${hint} `);

    if (answer === '') return defaultYes;
    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

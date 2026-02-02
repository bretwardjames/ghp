import chalk from 'chalk';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { exit } from '../exit.js';

interface InstallCommandsOptions {
    claude?: boolean;
    only?: string;
    force?: boolean;
    namespace?: string;
}

// Get the directory where this package is installed
function getPackageDir(): string {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    // From dist/commands/ go up to package root
    return join(__dirname, '..', '..');
}

// Get available bundled commands for a platform
function getBundledCommands(platform: string): Map<string, string> {
    const packageDir = getPackageDir();
    const commandsDir = join(packageDir, 'slash-commands', platform);
    const commands = new Map<string, string>();

    if (!existsSync(commandsDir)) {
        return commands;
    }

    const files = readdirSync(commandsDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
        const name = basename(file, '.md');
        const content = readFileSync(join(commandsDir, file), 'utf-8');
        commands.set(name, content);
    }

    return commands;
}

// Install commands to the target directory
function installCommands(
    commands: Map<string, string>,
    targetDir: string,
    options: { force?: boolean; namespace?: string; only?: string[] }
): { installed: string[]; skipped: string[]; failed: string[] } {
    const result = { installed: [] as string[], skipped: [] as string[], failed: [] as string[] };
    const namespace = options.namespace || 'ghp';

    // Ensure target directory exists
    if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
    }

    for (const [name, content] of commands) {
        // Filter by --only if specified
        if (options.only && options.only.length > 0 && !options.only.includes(name)) {
            continue;
        }

        const targetName = `${namespace}-${name}.md`;
        const targetPath = join(targetDir, targetName);

        // Check if file exists
        if (existsSync(targetPath) && !options.force) {
            result.skipped.push(name);
            continue;
        }

        try {
            // Apply namespace substitution
            const processedContent = content
                .replace(/\{\{namespace\}\}/g, namespace)
                .replace(/\{\{NAMESPACE\}\}/g, namespace.toUpperCase());

            writeFileSync(targetPath, processedContent);
            result.installed.push(name);
        } catch (err) {
            result.failed.push(name);
        }
    }

    return result;
}

export async function installCommandsCommand(options: InstallCommandsOptions): Promise<void> {
    // Default to --claude if no platform specified
    if (!options.claude) {
        console.log(chalk.yellow('No platform specified. Use --claude to install Claude commands.'));
        console.log();
        console.log('Usage:');
        console.log('  ', chalk.cyan('ghp install-commands --claude'));
        console.log('  ', chalk.cyan('ghp install-commands --claude --only start,save'));
        console.log('  ', chalk.cyan('ghp install-commands --claude --force'));
        console.log('  ', chalk.cyan('ghp install-commands --claude --namespace myproject'));
        return;
    }

    if (options.claude) {
        await installClaudeCommands(options);
    }
}

async function installClaudeCommands(options: InstallCommandsOptions): Promise<void> {
    console.log(chalk.bold('Installing Claude slash commands...'));
    console.log();

    // Get bundled commands
    const commands = getBundledCommands('claude');

    if (commands.size === 0) {
        console.error(chalk.red('Error:'), 'No bundled Claude commands found');
        console.log('This may indicate a packaging issue.');
        exit(1);
    }

    console.log(chalk.dim(`Found ${commands.size} bundled commands: ${Array.from(commands.keys()).join(', ')}`));

    // Determine target directory
    const targetDir = join(process.cwd(), '.claude', 'commands');

    // Parse --only flag
    const only = options.only ? options.only.split(',').map(s => s.trim()) : undefined;

    // Install commands
    const result = installCommands(commands, targetDir, {
        force: options.force,
        namespace: options.namespace,
        only,
    });

    console.log();

    // Report results
    if (result.installed.length > 0) {
        console.log(chalk.green('✓'), `Installed: ${result.installed.map(n => chalk.cyan(`${options.namespace || 'ghp'}-${n}`)).join(', ')}`);
    }

    if (result.skipped.length > 0) {
        console.log(chalk.yellow('○'), `Skipped (already exist): ${result.skipped.map(n => chalk.dim(`${options.namespace || 'ghp'}-${n}`)).join(', ')}`);
        console.log(chalk.dim('  Use --force to overwrite existing files'));
    }

    if (result.failed.length > 0) {
        console.log(chalk.red('✗'), `Failed: ${result.failed.join(', ')}`);
    }

    console.log();
    console.log(chalk.dim(`Commands installed to: ${targetDir}`));

    if (result.installed.length > 0) {
        console.log();
        console.log(chalk.bold('Usage in Claude:'));
        const namespace = options.namespace || 'ghp';
        console.log(`  /${namespace}-start [issue]    Start working on an issue`);
        console.log(`  /${namespace}-save             Save session context`);
        console.log(`  /${namespace}-handoff          Prepare handoff note`);
        console.log(`  /${namespace}-create-pr        Create pull request`);
    }
}

// Export for use by mcp command
export async function installClaudeCommandsQuiet(options: { force?: boolean; namespace?: string }): Promise<{ installed: string[]; skipped: string[]; targetDir: string } | null> {
    const commands = getBundledCommands('claude');
    if (commands.size === 0) {
        return null;
    }

    const targetDir = join(process.cwd(), '.claude', 'commands');
    const result = installCommands(commands, targetDir, options);
    const namespace = options.namespace || 'ghp';

    return {
        installed: result.installed.map(n => `${namespace}-${n}`),
        skipped: result.skipped.map(n => `${namespace}-${n}`),
        targetDir,
    };
}

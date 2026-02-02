import chalk from 'chalk';
import { spawnSync } from 'child_process';
import { confirmWithDefault, promptSelectWithDefault, isInteractive } from '../prompts.js';

export interface UpdateOptions {
    /** Skip prompts and update all packages */
    yes?: boolean;
    /** Force beta versions */
    beta?: boolean;
    /** Force stable versions */
    stable?: boolean;
    /** Check for updates without installing */
    check?: boolean;
}

interface PackageInfo {
    name: string;
    displayName: string;
    installed: string | null;
    latest: string;
    latestBeta: string | null;
}

const PACKAGES = [
    { name: '@bretwardjames/ghp-cli', displayName: 'CLI (ghp)' },
    { name: '@bretwardjames/ghp-mcp', displayName: 'MCP Server' },
];

function getInstalledVersion(packageName: string): string | null {
    try {
        // Use spawnSync with array args to prevent command injection
        const result = spawnSync('npm', ['list', '-g', packageName, '--json'], {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (result.status !== 0) return null;
        const data = JSON.parse(result.stdout);
        return data.dependencies?.[packageName]?.version || null;
    } catch {
        return null;
    }
}

function getLatestVersion(packageName: string, tag: 'latest' | 'beta'): string | null {
    try {
        // Use spawnSync with array args to prevent command injection
        const result = spawnSync('npm', ['view', `${packageName}@${tag}`, 'version'], {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (result.status !== 0) return null;
        return result.stdout.trim() || null;
    } catch {
        return null;
    }
}

function isBetaVersion(version: string): boolean {
    return version.includes('beta') || version.includes('alpha') || version.includes('rc');
}

function getPackageInfo(): PackageInfo[] {
    return PACKAGES.map(pkg => {
        const installed = getInstalledVersion(pkg.name);
        const latest = getLatestVersion(pkg.name, 'latest') || 'unknown';
        const latestBeta = getLatestVersion(pkg.name, 'beta');

        return {
            name: pkg.name,
            displayName: pkg.displayName,
            installed,
            latest,
            latestBeta,
        };
    });
}

function installPackage(packageName: string, version: string): boolean {
    try {
        console.log(chalk.dim(`  Installing ${packageName}@${version}...`));
        // Use spawnSync with array args to prevent command injection
        const result = spawnSync('npm', ['install', '-g', `${packageName}@${version}`], {
            encoding: 'utf-8',
            stdio: 'pipe',
        });
        if (result.status !== 0) {
            const errorMsg = result.stderr?.trim() || 'Unknown error';
            console.error(chalk.red(`  Failed to install ${packageName}@${version}`));
            console.error(chalk.dim(`  ${errorMsg}`));
            return false;
        }
        return true;
    } catch (error) {
        console.error(chalk.red(`  Failed to install ${packageName}@${version}`));
        if (error instanceof Error) {
            console.error(chalk.dim(`  ${error.message}`));
        }
        return false;
    }
}

export async function updateCommand(options: UpdateOptions): Promise<void> {
    // Validate conflicting flags
    if (options.beta && options.stable) {
        console.error(chalk.red('Error:'), 'Cannot specify both --beta and --stable');
        process.exit(1);
    }

    console.log(chalk.bold('Checking for updates...\n'));

    const packages = getPackageInfo();

    // Check if we could reach npm registry
    const hasNetworkIssue = packages.every(p => p.latest === 'unknown' && !p.latestBeta);
    if (hasNetworkIssue) {
        console.error(chalk.red('Error:'), 'Could not fetch package versions. Check your network connection.');
        process.exit(1);
    }

    // Determine if we should use beta based on CLI version
    const cliInfo = packages.find(p => p.name === '@bretwardjames/ghp-cli');
    const cliIsBeta = cliInfo?.installed ? isBetaVersion(cliInfo.installed) : false;

    // Determine target channel
    let useBeta: boolean;
    if (options.beta) {
        useBeta = true;
    } else if (options.stable) {
        useBeta = false;
    } else {
        useBeta = cliIsBeta;
    }

    const channel = useBeta ? 'beta' : 'stable';
    console.log(chalk.dim(`Update channel: ${channel}${!options.beta && !options.stable ? ' (detected from CLI)' : ''}\n`));

    // Show current status
    console.log(chalk.bold('Package Status:'));
    console.log('');

    const updatesAvailable: { pkg: PackageInfo; targetVersion: string }[] = [];

    for (const pkg of packages) {
        const targetVersion = useBeta && pkg.latestBeta ? pkg.latestBeta : pkg.latest;
        const installedStr = pkg.installed || chalk.dim('not installed');
        const needsUpdate = !pkg.installed || pkg.installed !== targetVersion;

        const status = needsUpdate
            ? chalk.yellow('→')
            : chalk.green('✓');

        console.log(`  ${status} ${pkg.displayName}`);
        console.log(`    Installed: ${installedStr}`);
        console.log(`    Available: ${targetVersion}${needsUpdate ? chalk.yellow(' (update available)') : ''}`);
        console.log('');

        if (needsUpdate) {
            updatesAvailable.push({ pkg, targetVersion });
        }
    }

    if (updatesAvailable.length === 0) {
        console.log(chalk.green('All packages are up to date!'));
        return;
    }

    // Check-only mode
    if (options.check) {
        console.log(chalk.dim(`${updatesAvailable.length} update(s) available. Run 'ghp update' to install.`));
        return;
    }

    // Determine which packages to update
    let packagesToUpdate: typeof updatesAvailable;

    if (options.yes) {
        // Update all without prompting
        packagesToUpdate = updatesAvailable;
    } else if (!isInteractive()) {
        // Non-interactive without --yes: just show what's available
        console.log(chalk.dim(`${updatesAvailable.length} update(s) available. Run 'ghp update --yes' to install.`));
        return;
    } else {
        // Ask user which packages to update
        const optionsList = [
            'Update all packages',
            ...updatesAvailable.map(({ pkg, targetVersion }) =>
                `Update ${pkg.displayName} only (${pkg.installed || 'not installed'} → ${targetVersion})`
            ),
            'Cancel',
        ];

        const choice = await promptSelectWithDefault(
            'Which packages do you want to update?',
            optionsList,
            0
        );

        if (choice === optionsList.length - 1) {
            // Cancel
            console.log(chalk.dim('Update cancelled.'));
            return;
        } else if (choice === 0) {
            // Update all
            packagesToUpdate = updatesAvailable;
        } else {
            // Update single package
            packagesToUpdate = [updatesAvailable[choice - 1]];
        }

        // Confirm
        const proceed = await confirmWithDefault(
            `Update ${packagesToUpdate.length} package(s)?`,
            true
        );

        if (!proceed) {
            console.log(chalk.dim('Update cancelled.'));
            return;
        }
    }

    // Install updates
    console.log('');
    console.log(chalk.bold('Installing updates...'));
    console.log('');

    let successCount = 0;
    let failCount = 0;

    for (const { pkg, targetVersion } of packagesToUpdate) {
        const success = installPackage(pkg.name, targetVersion);
        if (success) {
            console.log(chalk.green(`  ✓ ${pkg.displayName} updated to ${targetVersion}`));
            successCount++;
        } else {
            failCount++;
        }
    }

    console.log('');
    if (failCount === 0) {
        console.log(chalk.green(`Successfully updated ${successCount} package(s)!`));
    } else {
        console.log(chalk.yellow(`Updated ${successCount} package(s), ${failCount} failed.`));
        process.exit(1);
    }
}

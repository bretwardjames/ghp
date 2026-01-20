import chalk from 'chalk';
import { api } from '../github-api.js';

interface AuthOptions {
    status?: boolean;
}

export async function authCommand(options: AuthOptions): Promise<void> {
    const authenticated = await api.authenticate();

    if (options.status) {
        if (authenticated) {
            console.log(chalk.green('✓ Authenticated as'), chalk.bold(api.username));
        } else {
            console.log(chalk.red('✗ Not authenticated'));
            console.log();
            console.log('To authenticate, either:');
            console.log('  1. Run', chalk.cyan('gh auth login'), '(recommended)');
            console.log('  2. Set', chalk.cyan('GITHUB_TOKEN'), 'environment variable');
        }
        return;
    }

    if (authenticated) {
        console.log(chalk.green('✓ Already authenticated as'), chalk.bold(api.username));
    } else {
        console.log(chalk.yellow('Authentication required.'));
        console.log();
        console.log('This CLI uses the GitHub CLI for authentication.');
        console.log('Run', chalk.cyan('gh auth login'), 'to authenticate.');
        console.log();
        console.log('Alternatively, set the', chalk.cyan('GITHUB_TOKEN'), 'environment variable.');
        process.exit(1);
    }
}

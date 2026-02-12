import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository } from '../git-utils.js';
import { exit } from '../exit.js';
import { formatStandupText, parseSince } from '@bretwardjames/ghp-core';

interface StandupOptions {
    since?: string;
    user?: string;
    timeline?: boolean;
    json?: boolean;
}

export async function standupCommand(options: StandupOptions): Promise<void> {
    // Parse --since flag (default: 24h)
    let since: Date;
    try {
        since = parseSince(options.since || '24h');
    } catch (err) {
        console.error(chalk.red('Error:'), (err as Error).message);
        exit(1);
        return;
    }

    // Detect repository
    const repo = await detectRepository();
    if (!repo) {
        console.error(chalk.red('Error:'), 'Not in a git repository with a GitHub remote');
        exit(1);
        return;
    }

    // Authenticate
    const authenticated = await api.authenticate();
    if (!authenticated) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run', chalk.cyan('ghp auth'));
        exit(1);
        return;
    }

    try {
        // Default: filter to current user. --user all = everyone, --user <name> = specific user
        const userFlag = options.user?.toLowerCase();
        const activityOptions = userFlag === 'all'
            ? {}
            : { user: options.user || undefined, mine: !options.user };

        const activities = await api.getRecentActivity(repo, since, activityOptions);

        if (options.json) {
            console.log(JSON.stringify({
                since: since.toISOString(),
                issueCount: activities.length,
                activities,
            }, null, 2));
            return;
        }

        // Use shared formatter from core
        const output = formatStandupText(activities, { since, timeline: options.timeline });
        console.log(output);
    } catch (err) {
        console.error(chalk.red('Error:'), (err as Error).message);
        exit(1);
    }
}

import chalk from 'chalk';
import { spawn } from 'child_process';
import { getParallelWorkConfig } from '../config.js';
import { isInsideTmux } from '../terminal-utils.js';
import { exit } from '../exit.js';

interface TmuxRenameOptions {
    template?: string;
}

/**
 * Resolve template vars in a title template string.
 * Reads {issueNumber}, {issueTitle}, {branch} from GHP_SPAWN_CONTEXT env var.
 */
function resolveTitle(template: string): string {
    let issueNumber = '';
    let issueTitle = '';
    let branch = '';

    const raw = process.env.GHP_SPAWN_CONTEXT;
    if (raw) {
        try {
            const ctx = JSON.parse(raw);
            issueNumber = String(ctx.issue?.number ?? '');
            issueTitle = ctx.issue?.title ?? '';
            branch = ctx.branch ?? '';
        } catch { /* ignore parse errors */ }
    }

    return template
        .replace(/\{issueNumber\}/g, issueNumber)
        .replace(/\{issueTitle\}/g, issueTitle)
        .replace(/\{branch\}/g, branch);
}

/**
 * Rename the current tmux window.
 * `tmux rename-window` without a -t flag targets the window of the calling pane.
 */
async function renameTmuxWindow(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn('tmux', ['rename-window', name], { stdio: 'ignore' });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`tmux rename-window exited with code ${code}`));
        });
    });
}

/**
 * Rename the current tmux window to a given title or named template.
 * Intended to be called from within a ghp parallel work pane (e.g. by Claude).
 *
 * Examples:
 *   ghp tmux rename "⏳ working"
 *   ghp tmux rename --template waiting
 */
export async function tmuxRenameCommand(title: string | undefined, options: TmuxRenameOptions): Promise<void> {
    if (!isInsideTmux()) {
        console.error(chalk.red('Error:'), 'Not inside a tmux session');
        exit(1);
        return;
    }

    let resolvedTitle: string;

    if (options.template) {
        const config = getParallelWorkConfig();
        const templateStr = config.tmuxTitleTemplates[options.template];
        if (!templateStr) {
            const available = Object.keys(config.tmuxTitleTemplates);
            console.error(chalk.red('Error:'), `Title template "${options.template}" not found.`);
            if (available.length > 0) {
                console.error(`Available templates: ${available.join(', ')}`);
            } else {
                console.error('No title templates configured. Add them under parallelWork.tmux.titleTemplates in your config.');
            }
            exit(1);
            return;
        }
        resolvedTitle = resolveTitle(templateStr);
    } else if (title) {
        resolvedTitle = resolveTitle(title);
    } else {
        console.error(chalk.red('Error:'), 'Provide a title or --template <name>');
        exit(1);
        return;
    }

    try {
        await renameTmuxWindow(resolvedTitle);
    } catch (error) {
        console.error(chalk.red('Error:'), 'Failed to rename tmux window:', error instanceof Error ? error.message : String(error));
        exit(1);
    }
}

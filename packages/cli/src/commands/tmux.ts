import chalk from 'chalk';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { getParallelWorkConfig, setConfigByPath, loadConfig } from '../config.js';
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
        // Silently no-op outside tmux — safe to call unconditionally from Claude hooks
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

// =============================================================================
// install-hooks
// =============================================================================

interface InstallHooksOptions {
    global?: boolean;
    force?: boolean;
}

/** The three lifecycle events we hook into */
const TMUX_HOOKS: Array<{ event: string; template: string; description: string }> = [
    { event: 'SessionStart', template: 'working', description: 'Rename window when Claude starts working' },
    { event: 'Stop',         template: 'done',    description: 'Rename window when Claude finishes' },
    { event: 'Notification', template: 'waiting', description: 'Rename window when Claude needs attention' },
];

/** Default title templates to add if none are configured */
const DEFAULT_TITLE_TEMPLATES: Record<string, string> = {
    working: '⚙️ {issueNumber}',
    waiting: '⏳ {issueNumber}',
    done:    '✅ {issueNumber}',
};

function readJsonFile(filePath: string): Record<string, unknown> {
    if (!existsSync(filePath)) return {};
    const content = readFileSync(filePath, 'utf-8');
    try {
        return JSON.parse(content);
    } catch (err) {
        console.error(chalk.red('Error:'), `Failed to parse ${filePath}: ${err instanceof Error ? err.message : err}`);
        console.error('Fix the JSON syntax error and try again.');
        exit(1);
        return {}; // unreachable — satisfies TypeScript
    }
}

function writeJsonFile(filePath: string, data: Record<string, unknown>): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Install Claude Code lifecycle hooks that call `ghp tmux rename` automatically.
 * Writes to .claude/settings.json (local) or ~/.claude/settings.json (--global).
 * Also installs default title templates into .ghp/config.json if none exist.
 */
export async function tmuxInstallHooksCommand(options: InstallHooksOptions): Promise<void> {
    // --- 1. Determine settings.json path ---
    const settingsPath = options.global
        ? join(homedir(), '.claude', 'settings.json')
        : join(process.cwd(), '.claude', 'settings.json');

    const scopeLabel = options.global ? 'global (~/.claude/settings.json)' : 'local (.claude/settings.json)';

    // --- 2. Load existing settings ---
    const settings = readJsonFile(settingsPath);
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

    // --- 3. Install each hook event ---
    let installed = 0;
    let skipped = 0;

    for (const { event, template, description } of TMUX_HOOKS) {
        const command = `ghp tmux rename --template ${template}`;
        const newEntry = { matcher: '', hooks: [{ type: 'command', command }] };

        const existing = (hooks[event] ?? []) as Array<{ hooks?: Array<{ command?: string }> }>;

        // Check if this exact command is already registered
        const alreadyPresent = existing.some(entry =>
            entry.hooks?.some(h => h.command === command)
        );

        if (alreadyPresent && !options.force) {
            console.log(chalk.dim(`  ○ ${event} — already registered`));
            skipped++;
            continue;
        }

        // Remove any existing ghp tmux rename entry if --force
        if (options.force) {
            hooks[event] = existing.filter(entry =>
                !entry.hooks?.some(h => h.command?.startsWith('ghp tmux rename'))
            );
        }

        (hooks[event] ??= []).push(newEntry);
        console.log(chalk.green('  ✓'), `${event} — ${description}`);
        installed++;
    }

    settings.hooks = hooks;
    writeJsonFile(settingsPath, settings);

    // --- 4. Install default title templates if none configured ---
    const config = loadConfig();
    const existingTemplates = config.parallelWork?.tmux?.titleTemplates ?? {};
    const missingTemplates: Record<string, string> = {};

    for (const [name, value] of Object.entries(DEFAULT_TITLE_TEMPLATES)) {
        if (!existingTemplates[name]) {
            missingTemplates[name] = value;
        }
    }

    if (Object.keys(missingTemplates).length > 0) {
        for (const [name, value] of Object.entries(missingTemplates)) {
            setConfigByPath(`parallelWork.tmux.titleTemplates.${name}`, value, 'user');
        }
        console.log();
        console.log(chalk.green('✓'), 'Added default title templates to user config:');
        for (const [name, value] of Object.entries(missingTemplates)) {
            console.log(`    ${chalk.cyan(name)}: ${chalk.dim(`"${value}"`)}`);
        }
        console.log(chalk.dim('  Customize with: ghp config parallelWork.tmux.titleTemplates.<name> "<value>"'));
    }

    // --- 5. Summary ---
    console.log();
    if (installed > 0) {
        console.log(chalk.green('✓'), `${installed} hook(s) installed to ${scopeLabel}`);
    }
    if (skipped > 0) {
        console.log(chalk.dim(`${skipped} hook(s) already present (use --force to overwrite)`));
    }
    if (installed === 0 && skipped > 0) {
        console.log(chalk.dim('Nothing to do.'));
    }
}

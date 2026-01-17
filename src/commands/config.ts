import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { spawn } from 'child_process';
import { dirname } from 'path';
import chalk from 'chalk';
import { getConfig, setConfig, listConfigWithSources, getFullConfigWithSources, CONFIG_KEYS, getConfigPath, getWorkspaceConfigPath, getUserConfigPath, syncFromVSCode, getVSCodeSettingsPaths, type Config, type ConfigScope, type ConfigSource, type PlanShortcut } from '../config.js';

const SOURCE_LABELS: Record<ConfigSource, string> = {
    'default': chalk.dim('(default)'),
    'workspace': chalk.cyan('(workspace)'),
    'user': chalk.green('(user)'),
};

type ConfigKey = typeof CONFIG_KEYS[number];

function isValidKey(key: string): key is ConfigKey {
    return (CONFIG_KEYS as readonly string[]).includes(key);
}

function resolveScope(options: { workspace?: boolean; user?: boolean }): ConfigScope {
    if (options.workspace) return 'workspace';
    return 'user';
}

function formatShortcut(shortcut: PlanShortcut, indent: string = ''): void {
    if (shortcut.status) {
        const statusVal = Array.isArray(shortcut.status)
            ? shortcut.status.join(', ')
            : shortcut.status;
        console.log(`${indent}status: ${statusVal}`);
    }
    if (shortcut.mine) console.log(`${indent}mine: true`);
    if (shortcut.unassigned) console.log(`${indent}unassigned: true`);
    if (shortcut.project) console.log(`${indent}project: ${shortcut.project}`);
    if (shortcut.sort) console.log(`${indent}sort: ${shortcut.sort}`);
    if (shortcut.slice && shortcut.slice.length > 0) {
        console.log(`${indent}slice: ${shortcut.slice.join(', ')}`);
    }
    // Show other properties that might exist (like list, all, group)
    const knownKeys = ['status', 'mine', 'unassigned', 'project', 'sort', 'slice'];
    for (const [key, value] of Object.entries(shortcut)) {
        if (!knownKeys.includes(key) && value !== undefined) {
            console.log(`${indent}${key}: ${value}`);
        }
    }
}

const CONFIG_TEMPLATE = `{
  "_comment": "ghp-cli configuration - see https://github.com/your/ghp-cli for docs",

  "mainBranch": "main",
  "branchPattern": "{user}/{number}-{title}",
  "startWorkingStatus": "In Progress",
  "doneStatus": "Done",

  "defaults": {
    "plan": {},
    "addIssue": {
      "template": "",
      "project": "",
      "status": "Backlog"
    }
  },

  "shortcuts": {
    "bugs": {
      "status": "Backlog",
      "slice": ["type=Bug"]
    },
    "mywork": {
      "status": "In Progress",
      "mine": true
    },
    "todo": {
      "status": "Todo",
      "unassigned": true
    }
  }
}
`;

function openInEditor(filePath: string): void {
    const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
    const child = spawn(editor, [filePath], {
        stdio: 'inherit',
        shell: true,
    });
    child.on('error', (err) => {
        console.error(`Failed to open editor: ${err.message}`);
        console.log(`Config file is at: ${filePath}`);
    });
}

export async function configSyncCommand(
    options: { workspace?: boolean; user?: boolean } = {}
): Promise<void> {
    const scope = resolveScope(options);

    console.log(chalk.bold('Syncing from VS Code/Cursor settings...'));
    console.log();

    const paths = getVSCodeSettingsPaths();
    console.log(chalk.dim('Looking for settings in:'));
    console.log(chalk.dim(`  Workspace: ${paths.workspace || '(not in git repo)'}`));
    console.log(chalk.dim(`  Cursor:    ${paths.cursorUser}`));
    console.log(chalk.dim(`  VS Code:   ${paths.codeUser}`));
    console.log();

    const result = syncFromVSCode(scope);

    // Report any parse errors
    if (result.errors.length > 0) {
        for (const error of result.errors) {
            console.log(chalk.yellow(`Warning: ${error}`));
        }
        console.log();
    }

    if (result.synced.length === 0) {
        if (result.skipped.length > 0) {
            console.log(chalk.yellow('No syncable settings found.'));
            console.log(chalk.dim(`Found ${result.skipped.length} extension-only setting(s): ${result.skipped.join(', ')}`));
            console.log();
            console.log(chalk.dim('Syncable settings: mainBranch, branchNamePattern, startWorkingStatus, prMergedStatus'));
        } else {
            console.log(chalk.yellow('No ghProjects.* settings found to sync.'));
            console.log(chalk.dim('Make sure you have settings like ghProjects.mainBranch in your editor.'));
        }
        return;
    }

    console.log(chalk.green(`Synced ${result.synced.length} setting(s) from ${result.editor}:`));
    for (const { key, value, source } of result.synced) {
        const sourceLabel = source === 'workspace' ? chalk.cyan('(workspace)') : chalk.green('(user)');
        console.log(`  ${key}: ${value} ${sourceLabel}`);
    }

    if (result.skipped.length > 0) {
        console.log();
        console.log(chalk.dim(`Skipped ${result.skipped.length} extension-only setting(s): ${result.skipped.join(', ')}`));
    }

    console.log();
    console.log(chalk.dim(`Saved to ${scope} config: ${getConfigPath(scope)}`));
}

export async function configCommand(
    key?: string,
    value?: string,
    options: { show?: boolean; edit?: boolean; workspace?: boolean; user?: boolean } = {}
): Promise<void> {
    const scope = resolveScope(options);

    // Handle 'sync' as first argument
    if (key === 'sync') {
        await configSyncCommand(options);
        return;
    }

    // --show: display merged config from all sources with source indicators
    if (options.show) {
        const fullConfig = getFullConfigWithSources();

        console.log('\n' + chalk.bold('Settings:'));
        console.log('─'.repeat(60));
        for (const [key, { value, source }] of Object.entries(fullConfig.settings)) {
            const sourceLabel = SOURCE_LABELS[source];
            console.log(`  ${key}: ${value || chalk.dim('(not set)')} ${sourceLabel}`);
        }

        console.log('\n' + chalk.bold('Defaults:'));
        console.log('─'.repeat(60));

        // Plan defaults
        const planDefaults = fullConfig.defaults.plan;
        const planSourceLabel = SOURCE_LABELS[planDefaults.source];
        if (Object.keys(planDefaults.value).length > 0) {
            console.log(`  ${chalk.cyan('plan')} ${planSourceLabel}`);
            formatShortcut(planDefaults.value, '    ');
        } else {
            console.log(`  ${chalk.cyan('plan')}: ${chalk.dim('(none)')} ${planSourceLabel}`);
        }

        // AddIssue defaults
        const addIssueDefaults = fullConfig.defaults.addIssue;
        const addIssueSourceLabel = SOURCE_LABELS[addIssueDefaults.source];
        if (Object.keys(addIssueDefaults.value).length > 0) {
            console.log(`  ${chalk.cyan('addIssue')} ${addIssueSourceLabel}`);
            for (const [k, v] of Object.entries(addIssueDefaults.value)) {
                if (v) console.log(`    ${k}: ${v}`);
            }
        } else {
            console.log(`  ${chalk.cyan('addIssue')}: ${chalk.dim('(none)')} ${addIssueSourceLabel}`);
        }

        console.log('\n' + chalk.bold('Shortcuts:'));
        console.log('─'.repeat(60));
        const shortcuts = fullConfig.shortcuts;
        if (Object.keys(shortcuts).length > 0) {
            for (const [name, { value, source }] of Object.entries(shortcuts)) {
                const sourceLabel = SOURCE_LABELS[source];
                console.log(`  ${chalk.cyan(name)} ${sourceLabel}`);
                formatShortcut(value, '    ');
            }
        } else {
            console.log(`  ${chalk.dim('(none)')}`);
        }

        console.log('\n' + chalk.bold('Config files:'));
        console.log('─'.repeat(60));
        console.log(`  User:      ${getUserConfigPath()}`);
        const workspacePath = getWorkspaceConfigPath();
        console.log(`  Workspace: ${workspacePath || '(not in a git repository)'}`);
        console.log('\nUse "ghp config" to edit user config');
        console.log('Use "ghp config -w" to edit workspace config (shared with team)');
        return;
    }

    // Get/set specific key
    if (key && !value) {
        if (!isValidKey(key)) {
            console.log(`Unknown config key: "${key}"`);
            console.log('Available keys:', CONFIG_KEYS.join(', '));
            return;
        }
        const val = getConfig(key as keyof Config);
        if (val !== undefined) {
            console.log(val);
        } else {
            console.log(`Config key "${key}" is not set`);
        }
        return;
    }

    if (key && value) {
        if (!isValidKey(key)) {
            console.log(`Unknown config key: "${key}"`);
            console.log('Available keys:', CONFIG_KEYS.join(', '));
            return;
        }
        setConfig(key as keyof Config, value as Config[keyof Config], scope);
        console.log(`Set ${key} = ${value} (in ${scope} config)`);
        return;
    }

    // Default: open editor (when no key/value provided)
    const configPath = getConfigPath(scope);

    if (scope === 'workspace' && configPath === '(not in a git repository)') {
        console.error('Error: Not in a git repository. Cannot edit workspace config.');
        return;
    }

    // Create config with template if it doesn't exist
    if (!existsSync(configPath)) {
        mkdirSync(dirname(configPath), { recursive: true });
        writeFileSync(configPath, CONFIG_TEMPLATE);
        console.log(`Created config file: ${configPath}`);
    }

    openInEditor(configPath);
}

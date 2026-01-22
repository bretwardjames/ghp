import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { spawn } from 'child_process';
import { dirname } from 'path';
import chalk from 'chalk';
import {
    getConfig, setConfig, listConfigWithSources, getFullConfigWithSources, CONFIG_KEYS,
    getConfigPath, getWorkspaceConfigPath, getUserConfigPath, getVSCodeSettingsPaths,
    getCliSyncableSettings, getVSCodeSyncableSettings, writeToVSCode, saveConfig,
    getConfigByPath, setConfigByPath, getConfigSection, parseValue,
    type Config, type ConfigScope, type ConfigSource, type PlanShortcut,
} from '../config.js';
import {
    computeSettingsDiff, hasDifferences, resolveConflicts, getDiffSummary,
    SETTING_DISPLAY_NAMES, CLI_TO_VSCODE_MAP,
    useCli, useVSCode, useCustom, skip,
    type ConflictChoices, type SyncableSettingKey,
} from '@bretwardjames/ghp-core';
import { promptSyncConflict, promptSyncUnique, promptConfirm } from '../prompts.js';

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

    console.log(chalk.bold('Bidirectional Settings Sync'));
    console.log(chalk.dim('Comparing CLI and VS Code/Cursor settings...'));
    console.log();

    // Get settings from both sources
    const cliSettings = getCliSyncableSettings();
    const { settings: vscodeSettings, editor, errors } = getVSCodeSyncableSettings();

    const paths = getVSCodeSettingsPaths();
    console.log(chalk.dim('Settings sources:'));
    console.log(chalk.dim(`  CLI:     ${getConfigPath(scope)}`));
    console.log(chalk.dim(`  ${editor === 'cursor' ? 'Cursor' : 'VS Code'}:  ${editor === 'cursor' ? paths.cursorUser : paths.codeUser}`));
    console.log();

    // Report any parse errors
    if (errors.length > 0) {
        for (const error of errors) {
            console.log(chalk.yellow(`Warning: ${error}`));
        }
        console.log();
    }

    // Compute the diff
    const diff = computeSettingsDiff(cliSettings, vscodeSettings);

    if (!hasDifferences(diff)) {
        console.log(chalk.green('Settings are already in sync.'));
        if (diff.matching.length > 0) {
            console.log(chalk.dim(`\n${diff.matching.length} setting(s) match:`));
            for (const { key, value } of diff.matching) {
                console.log(chalk.dim(`  ${SETTING_DISPLAY_NAMES[key]}: ${value}`));
            }
        }
        return;
    }

    console.log(chalk.yellow('Differences found:'), getDiffSummary(diff));

    // Collect user choices
    const choices: ConflictChoices = {};

    // Handle conflicts (settings that differ)
    for (const conflict of diff.conflicts) {
        const result = await promptSyncConflict({
            key: conflict.key,
            displayName: conflict.displayName,
            cliValue: conflict.cliValue,
            vscodeValue: conflict.vscodeValue,
        });

        if (result === 'cli') {
            choices[conflict.key] = useCli();
        } else if (result === 'vscode') {
            choices[conflict.key] = useVSCode();
        } else if (result === 'skip') {
            choices[conflict.key] = skip();
        } else {
            // Custom value
            choices[conflict.key] = useCustom(result.custom);
        }
    }

    // Handle settings only in CLI
    const syncCliOnly: SyncableSettingKey[] = [];
    for (const { key, value } of diff.cliOnly) {
        const shouldSync = await promptSyncUnique({
            key,
            displayName: SETTING_DISPLAY_NAMES[key],
            value,
            source: 'cli',
        });
        if (shouldSync) {
            syncCliOnly.push(key);
        }
    }

    // Handle settings only in VSCode
    const syncVscodeOnly: SyncableSettingKey[] = [];
    for (const { key, value } of diff.vscodeOnly) {
        const shouldSync = await promptSyncUnique({
            key,
            displayName: SETTING_DISPLAY_NAMES[key],
            value,
            source: 'vscode',
        });
        if (shouldSync) {
            syncVscodeOnly.push(key);
        }
    }

    // Resolve and compute final settings
    const resolved = resolveConflicts(diff, choices, false); // Don't auto-sync unique

    // Add the user-approved unique syncs
    for (const key of syncCliOnly) {
        const value = cliSettings[key];
        if (value) {
            resolved.vscode[CLI_TO_VSCODE_MAP[key]] = value;
        }
    }
    for (const key of syncVscodeOnly) {
        const value = vscodeSettings[key];
        if (value) {
            resolved.cli[key] = value;
        }
    }

    // Check if there's anything to do
    const hasCliUpdates = Object.keys(resolved.cli).length > 0;
    const hasVscodeUpdates = Object.keys(resolved.vscode).length > 0;

    if (!hasCliUpdates && !hasVscodeUpdates) {
        console.log();
        console.log(chalk.yellow('No changes to apply.'));
        return;
    }

    // Show summary of changes
    console.log();
    console.log(chalk.bold('Changes to apply:'));

    if (hasCliUpdates) {
        console.log(chalk.cyan('\n  CLI config:'));
        for (const [key, value] of Object.entries(resolved.cli)) {
            console.log(`    ${SETTING_DISPLAY_NAMES[key as SyncableSettingKey]}: ${value}`);
        }
    }

    if (hasVscodeUpdates) {
        console.log(chalk.magenta(`\n  ${editor === 'cursor' ? 'Cursor' : 'VS Code'} settings:`));
        for (const [key, value] of Object.entries(resolved.vscode)) {
            console.log(`    ghProjects.${key}: ${value}`);
        }
    }

    console.log();
    const confirmed = await promptConfirm('Apply these changes?');

    if (!confirmed) {
        console.log(chalk.yellow('Sync cancelled.'));
        return;
    }

    // Apply changes
    let cliSuccess = true;
    let vscodeSuccess = true;

    if (hasCliUpdates) {
        try {
            saveConfig(resolved.cli, scope);
            console.log(chalk.green('CLI config updated.'));
        } catch (err) {
            cliSuccess = false;
            console.log(chalk.red(`Failed to update CLI config: ${err instanceof Error ? err.message : err}`));
        }
    }

    if (hasVscodeUpdates) {
        const result = writeToVSCode(resolved.vscode, editor, 'user');
        if (result.success) {
            console.log(chalk.green(`${editor === 'cursor' ? 'Cursor' : 'VS Code'} settings updated.`));
        } else {
            vscodeSuccess = false;
            console.log(chalk.red(`Failed to update ${editor} settings: ${result.error}`));
        }
    }

    if (cliSuccess && vscodeSuccess) {
        console.log();
        console.log(chalk.green('Sync complete.'));
    }
}

/**
 * Format a config value for display
 */
function formatConfigValue(value: unknown, indent: string = ''): void {
    if (value === null || value === undefined) {
        console.log(`${indent}${chalk.dim('(not set)')}`);
        return;
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
                console.log(`${indent}${chalk.cyan(k)}:`);
                formatConfigValue(v, indent + '  ');
            } else {
                const displayVal = Array.isArray(v) ? v.join(', ') : String(v);
                console.log(`${indent}${k}: ${displayVal}`);
            }
        }
    } else if (Array.isArray(value)) {
        console.log(`${indent}${value.join(', ')}`);
    } else {
        console.log(`${indent}${value}`);
    }
}

/**
 * Determine the scope for --show: if -w, show workspace only; if -u, show user only
 */
function resolveShowScope(options: { workspace?: boolean; user?: boolean }): ConfigScope | 'merged' {
    if (options.workspace) return 'workspace';
    if (options.user) return 'user';
    return 'merged';
}

export async function configCommand(
    key?: string,
    value?: string,
    options: {
        show?: boolean;
        edit?: boolean;
        workspace?: boolean;
        user?: boolean;
        disableTool?: string;
        enableTool?: string;
    } = {}
): Promise<void> {
    const scope = resolveScope(options);

    // Handle 'sync' as first argument
    if (key === 'sync') {
        await configSyncCommand(options);
        return;
    }

    // Handle --disable-tool convenience command
    if (options.disableTool) {
        const toolName = options.disableTool;
        const currentDisabled = (getConfigByPath('mcp.disabledTools') as string[] | undefined) || [];
        if (!currentDisabled.includes(toolName)) {
            currentDisabled.push(toolName);
            setConfigByPath('mcp.disabledTools', currentDisabled, scope);
            console.log(`Disabled tool "${toolName}" (in ${scope} config)`);
        } else {
            console.log(`Tool "${toolName}" is already disabled`);
        }
        return;
    }

    // Handle --enable-tool convenience command
    if (options.enableTool) {
        const toolName = options.enableTool;
        const currentDisabled = (getConfigByPath('mcp.disabledTools') as string[] | undefined) || [];
        const index = currentDisabled.indexOf(toolName);
        if (index !== -1) {
            currentDisabled.splice(index, 1);
            setConfigByPath('mcp.disabledTools', currentDisabled, scope);
            console.log(`Enabled tool "${toolName}" (in ${scope} config)`);
        } else {
            console.log(`Tool "${toolName}" is not disabled`);
        }
        return;
    }

    // --show: display config with optional section filtering and scope filtering
    if (options.show) {
        const showScope = resolveShowScope(options);

        // If a key/section is provided, show only that section
        if (key) {
            const sectionValue = getConfigSection(key, showScope === 'merged' ? undefined : showScope);

            if (showScope === 'merged') {
                console.log(`\n${chalk.bold(key)} ${chalk.dim('(merged)')}`);
            } else {
                console.log(`\n${chalk.bold(key)} ${SOURCE_LABELS[showScope]}`);
            }
            console.log('─'.repeat(60));

            if (sectionValue === undefined) {
                console.log(chalk.dim('  (not set)'));
            } else {
                formatConfigValue(sectionValue, '  ');
            }
            return;
        }

        // Show full config (with scope filter if specified)
        if (showScope !== 'merged') {
            // Show only one scope
            const scopedConfig = getConfigSection('', showScope) as Record<string, unknown> | undefined;
            console.log(`\n${chalk.bold('Config')} ${SOURCE_LABELS[showScope]}`);
            console.log('─'.repeat(60));
            if (scopedConfig && Object.keys(scopedConfig).length > 0) {
                formatConfigValue(scopedConfig, '  ');
            } else {
                console.log(chalk.dim('  (empty)'));
            }
            console.log(`\nFile: ${getConfigPath(showScope)}`);
            return;
        }

        // Show merged config with sources (original behavior)
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

    // Get/set with dotted path support
    if (key && !value) {
        // Get a value (supports dotted paths like "mcp.tools.workflows")
        const val = key.includes('.') ? getConfigByPath(key) : getConfig(key as keyof Config);
        if (val !== undefined) {
            if (typeof val === 'object') {
                formatConfigValue(val);
            } else {
                console.log(val);
            }
        } else {
            console.log(`Config key "${key}" is not set`);
        }
        return;
    }

    if (key && value) {
        // Set a value (supports dotted paths like "mcp.tools.workflows")
        const parsedValue = parseValue(value);
        if (key.includes('.')) {
            setConfigByPath(key, parsedValue, scope);
        } else {
            setConfig(key as keyof Config, parsedValue as Config[keyof Config], scope);
        }
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

/**
 * Bidirectional settings sync between VSCode extension and ghp-cli
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    computeSettingsDiff,
    hasDifferences,
    resolveConflicts,
    getDiffSummary,
    SETTING_DISPLAY_NAMES,
    CLI_TO_VSCODE_MAP,
    VSCODE_TO_CLI_MAP,
    SYNCABLE_KEYS,
    useCli,
    useVSCode,
    useCustom,
    skip,
    type SyncableSettings,
    type SyncableSettingKey,
    type ConflictChoices,
    type SettingConflict,
} from '@bretwardjames/ghp-core';

// CLI config paths
const CLI_USER_CONFIG_DIR = path.join(os.homedir(), '.config', 'ghp-cli');
const CLI_USER_CONFIG_FILE = path.join(CLI_USER_CONFIG_DIR, 'config.json');

/**
 * Read CLI config and extract syncable settings
 */
function getCliSyncableSettings(): SyncableSettings {
    try {
        if (fs.existsSync(CLI_USER_CONFIG_FILE)) {
            const content = fs.readFileSync(CLI_USER_CONFIG_FILE, 'utf-8');
            const config = JSON.parse(content);
            return {
                mainBranch: config.mainBranch,
                branchPattern: config.branchPattern,
                startWorkingStatus: config.startWorkingStatus,
                doneStatus: config.doneStatus,
            };
        }
    } catch (err) {
        console.error('Failed to read CLI config:', err);
    }
    return {};
}

/**
 * Get VSCode extension settings as SyncableSettings
 */
function getVSCodeSyncableSettings(): SyncableSettings {
    const config = vscode.workspace.getConfiguration('ghProjects');
    const settings: SyncableSettings = {};

    for (const [vscodeKey, cliKey] of Object.entries(VSCODE_TO_CLI_MAP)) {
        const value = config.get<string>(vscodeKey);
        if (value !== undefined && value !== '') {
            settings[cliKey] = value;
        }
    }

    return settings;
}

/**
 * Write settings to CLI config file
 */
function writeToCliConfig(settings: SyncableSettings): { success: boolean; error?: string } {
    try {
        // Read existing config
        let existing: Record<string, unknown> = {};
        if (fs.existsSync(CLI_USER_CONFIG_FILE)) {
            const content = fs.readFileSync(CLI_USER_CONFIG_FILE, 'utf-8');
            existing = JSON.parse(content);
        }

        // Merge settings
        for (const [key, value] of Object.entries(settings)) {
            if (value !== undefined) {
                existing[key] = value;
            }
        }

        // Ensure directory exists
        if (!fs.existsSync(CLI_USER_CONFIG_DIR)) {
            fs.mkdirSync(CLI_USER_CONFIG_DIR, { recursive: true });
        }

        // Write back
        fs.writeFileSync(CLI_USER_CONFIG_FILE, JSON.stringify(existing, null, 2));
        return { success: true };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

/**
 * Write settings to VSCode config
 */
async function writeToVSCodeConfig(settings: Record<string, string>): Promise<{ success: boolean; error?: string }> {
    try {
        const config = vscode.workspace.getConfiguration('ghProjects');

        for (const [key, value] of Object.entries(settings)) {
            await config.update(key, value, vscode.ConfigurationTarget.Global);
        }

        return { success: true };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

interface ConflictQuickPickItem extends vscode.QuickPickItem {
    resolution: 'cli' | 'vscode' | 'custom' | 'skip';
}

/**
 * Show quick pick for resolving a single conflict
 */
async function promptConflictResolution(
    conflict: SettingConflict
): Promise<'cli' | 'vscode' | 'skip' | { custom: string } | null> {
    const items: ConflictQuickPickItem[] = [
        {
            label: `$(terminal) CLI: "${conflict.cliValue ?? '(not set)'}"`,
            description: 'Use CLI value, update VSCode',
            resolution: 'cli',
        },
        {
            label: `$(code) VSCode: "${conflict.vscodeValue ?? '(not set)'}"`,
            description: 'Use VSCode value, update CLI',
            resolution: 'vscode',
        },
        {
            label: '$(edit) Enter custom value',
            description: 'Use a new value for both',
            resolution: 'custom',
        },
        {
            label: '$(close) Skip',
            description: 'Keep both values as-is',
            resolution: 'skip',
        },
    ];

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `${conflict.displayName}: Choose which value to use`,
        title: 'Resolve Setting Conflict',
    });

    if (!selected) {
        return null; // User cancelled
    }

    if (selected.resolution === 'custom') {
        const customValue = await vscode.window.showInputBox({
            prompt: `Enter new value for ${conflict.displayName}`,
            value: conflict.vscodeValue ?? conflict.cliValue ?? '',
        });
        if (customValue === undefined) {
            return null; // User cancelled
        }
        return { custom: customValue };
    }

    return selected.resolution;
}

/**
 * Execute the sync settings command
 */
export async function executeSyncSettings(): Promise<void> {
    // Get settings from both sources
    const cliSettings = getCliSyncableSettings();
    const vscodeSettings = getVSCodeSyncableSettings();

    // Compute diff
    const diff = computeSettingsDiff(cliSettings, vscodeSettings);

    if (!hasDifferences(diff)) {
        // Check if there are any matching settings to show
        if (diff.matching.length > 0) {
            const matchInfo = diff.matching
                .map(({ key, value }) => `${SETTING_DISPLAY_NAMES[key]}: ${value}`)
                .join('\n');
            vscode.window.showInformationMessage(
                'Settings are already in sync.',
                { modal: false, detail: matchInfo }
            );
        } else {
            vscode.window.showInformationMessage('No syncable settings found in either CLI or VSCode.');
        }
        return;
    }

    // Show summary
    const summary = getDiffSummary(diff);
    const proceed = await vscode.window.showInformationMessage(
        `Settings differ between CLI and VSCode: ${summary}`,
        'Review & Sync',
        'Cancel'
    );

    if (proceed !== 'Review & Sync') {
        return;
    }

    // Collect user choices
    const choices: ConflictChoices = {};
    const syncCliOnly: SyncableSettingKey[] = [];
    const syncVscodeOnly: SyncableSettingKey[] = [];

    // Handle conflicts
    for (const conflict of diff.conflicts) {
        const result = await promptConflictResolution(conflict);
        if (result === null) {
            vscode.window.showInformationMessage('Sync cancelled.');
            return;
        }

        if (result === 'cli') {
            choices[conflict.key] = useCli();
        } else if (result === 'vscode') {
            choices[conflict.key] = useVSCode();
        } else if (result === 'skip') {
            choices[conflict.key] = skip();
        } else {
            choices[conflict.key] = useCustom(result.custom);
        }
    }

    // Handle CLI-only settings
    for (const { key, value } of diff.cliOnly) {
        const sync = await vscode.window.showQuickPick(
            [
                { label: '$(check) Yes', description: 'Copy to VSCode settings', value: true },
                { label: '$(close) No', description: 'Keep only in CLI', value: false },
            ],
            {
                placeHolder: `${SETTING_DISPLAY_NAMES[key]}: "${value}" exists only in CLI. Sync to VSCode?`,
            }
        );
        if (sync === undefined) {
            vscode.window.showInformationMessage('Sync cancelled.');
            return;
        }
        if (sync.value) {
            syncCliOnly.push(key);
        }
    }

    // Handle VSCode-only settings
    for (const { key, value } of diff.vscodeOnly) {
        const sync = await vscode.window.showQuickPick(
            [
                { label: '$(check) Yes', description: 'Copy to CLI config', value: true },
                { label: '$(close) No', description: 'Keep only in VSCode', value: false },
            ],
            {
                placeHolder: `${SETTING_DISPLAY_NAMES[key]}: "${value}" exists only in VSCode. Sync to CLI?`,
            }
        );
        if (sync === undefined) {
            vscode.window.showInformationMessage('Sync cancelled.');
            return;
        }
        if (sync.value) {
            syncVscodeOnly.push(key);
        }
    }

    // Resolve conflicts
    const resolved = resolveConflicts(diff, choices, false);

    // Add user-approved unique syncs
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
        vscode.window.showInformationMessage('No changes to apply.');
        return;
    }

    // Show summary of changes and confirm
    const changesSummary: string[] = [];
    if (hasCliUpdates) {
        changesSummary.push(`CLI: ${Object.keys(resolved.cli).map(k => SETTING_DISPLAY_NAMES[k as SyncableSettingKey]).join(', ')}`);
    }
    if (hasVscodeUpdates) {
        changesSummary.push(`VSCode: ${Object.keys(resolved.vscode).join(', ')}`);
    }

    const confirm = await vscode.window.showInformationMessage(
        `Apply changes to: ${changesSummary.join(' and ')}?`,
        'Apply',
        'Cancel'
    );

    if (confirm !== 'Apply') {
        vscode.window.showInformationMessage('Sync cancelled.');
        return;
    }

    // Apply changes
    let success = true;
    const errors: string[] = [];

    if (hasCliUpdates) {
        const result = writeToCliConfig(resolved.cli);
        if (!result.success) {
            success = false;
            errors.push(`CLI: ${result.error}`);
        }
    }

    if (hasVscodeUpdates) {
        const result = await writeToVSCodeConfig(resolved.vscode);
        if (!result.success) {
            success = false;
            errors.push(`VSCode: ${result.error}`);
        }
    }

    if (success) {
        vscode.window.showInformationMessage('Settings synced successfully.');
    } else {
        vscode.window.showErrorMessage(`Sync partially failed: ${errors.join('; ')}`);
    }
}

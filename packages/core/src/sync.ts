/**
 * Settings Sync Module
 *
 * Provides shared logic for bidirectional sync between ghp-cli and VSCode extension.
 * This module handles the 4 settings that overlap between CLI and VSCode:
 * - mainBranch
 * - branchPattern (CLI) / branchNamePattern (VSCode)
 * - startWorkingStatus
 * - doneStatus (CLI) / prMergedStatus (VSCode)
 */

// =============================================================================
// Types
// =============================================================================

/**
 * The canonical setting keys used in sync operations.
 * These are the CLI key names (used as the canonical form).
 */
export type SyncableSettingKey = 'mainBranch' | 'branchPattern' | 'startWorkingStatus' | 'doneStatus';

/**
 * Settings that can be synced between CLI and VSCode.
 * Uses CLI key names as the canonical form.
 */
export interface SyncableSettings {
    mainBranch?: string;
    branchPattern?: string;
    startWorkingStatus?: string;
    doneStatus?: string;
}

/**
 * A source of settings (CLI or VSCode)
 */
export type SettingsSource = 'cli' | 'vscode';

/**
 * Represents a conflict where a setting has different values in CLI and VSCode
 */
export interface SettingConflict {
    key: SyncableSettingKey;
    displayName: string;
    cliValue: string | undefined;
    vscodeValue: string | undefined;
}

/**
 * Result of comparing CLI and VSCode settings
 */
export interface SettingsDiff {
    /** Settings that differ between CLI and VSCode */
    conflicts: SettingConflict[];
    /** Settings that are the same in both */
    matching: Array<{ key: SyncableSettingKey; value: string }>;
    /** Settings only defined in CLI */
    cliOnly: Array<{ key: SyncableSettingKey; value: string }>;
    /** Settings only defined in VSCode */
    vscodeOnly: Array<{ key: SyncableSettingKey; value: string }>;
}

/**
 * User's choice for how to resolve a conflict
 */
export type ConflictResolution =
    | { type: 'cli' }
    | { type: 'vscode' }
    | { type: 'custom'; value: string }
    | { type: 'skip' };

/**
 * Map of user choices for each conflicting setting
 */
export type ConflictChoices = Partial<Record<SyncableSettingKey, ConflictResolution>>;

/**
 * Result of resolving conflicts - settings to write to each target
 */
export interface ResolvedSettings {
    /** Settings to write to CLI config */
    cli: SyncableSettings;
    /** Settings to write to VSCode (using VSCode key names) */
    vscode: Record<string, string>;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * All syncable setting keys
 */
export const SYNCABLE_KEYS: readonly SyncableSettingKey[] = [
    'mainBranch',
    'branchPattern',
    'startWorkingStatus',
    'doneStatus',
] as const;

/**
 * Human-readable names for each setting
 */
export const SETTING_DISPLAY_NAMES: Record<SyncableSettingKey, string> = {
    mainBranch: 'Main Branch',
    branchPattern: 'Branch Name Pattern',
    startWorkingStatus: 'Start Working Status',
    doneStatus: 'Done/PR Merged Status',
};

/**
 * Mapping from VSCode setting keys to CLI setting keys
 */
export const VSCODE_TO_CLI_MAP: Record<string, SyncableSettingKey> = {
    'mainBranch': 'mainBranch',
    'branchNamePattern': 'branchPattern',
    'startWorkingStatus': 'startWorkingStatus',
    'prMergedStatus': 'doneStatus',
};

/**
 * Mapping from CLI setting keys to VSCode setting keys
 */
export const CLI_TO_VSCODE_MAP: Record<SyncableSettingKey, string> = {
    mainBranch: 'mainBranch',
    branchPattern: 'branchNamePattern',
    startWorkingStatus: 'startWorkingStatus',
    doneStatus: 'prMergedStatus',
};

/**
 * Default values for each setting
 */
export const DEFAULT_VALUES: Record<SyncableSettingKey, string> = {
    mainBranch: 'main',
    branchPattern: '{user}/{number}-{title}',
    startWorkingStatus: 'In Progress',
    doneStatus: 'Done',
};

// =============================================================================
// Functions
// =============================================================================

/**
 * Convert VSCode settings object to canonical CLI key names
 */
export function normalizeVSCodeSettings(vscodeSettings: Record<string, unknown>): SyncableSettings {
    const result: SyncableSettings = {};

    for (const [vscodeKey, cliKey] of Object.entries(VSCODE_TO_CLI_MAP)) {
        const value = vscodeSettings[vscodeKey];
        if (typeof value === 'string' && value.trim() !== '') {
            result[cliKey] = value;
        }
    }

    return result;
}

/**
 * Convert CLI settings to VSCode key names (with ghProjects. prefix)
 */
export function toVSCodeSettings(settings: SyncableSettings, includePrefix = true): Record<string, string> {
    const result: Record<string, string> = {};
    const prefix = includePrefix ? 'ghProjects.' : '';

    for (const [cliKey, value] of Object.entries(settings)) {
        if (value !== undefined) {
            const vscodeKey = CLI_TO_VSCODE_MAP[cliKey as SyncableSettingKey];
            if (vscodeKey) {
                result[`${prefix}${vscodeKey}`] = value;
            }
        }
    }

    return result;
}

/**
 * Compare settings from CLI and VSCode and identify differences
 */
export function computeSettingsDiff(
    cliSettings: SyncableSettings,
    vscodeSettings: SyncableSettings
): SettingsDiff {
    const diff: SettingsDiff = {
        conflicts: [],
        matching: [],
        cliOnly: [],
        vscodeOnly: [],
    };

    for (const key of SYNCABLE_KEYS) {
        const cliValue = cliSettings[key];
        const vscodeValue = vscodeSettings[key];

        const cliDefined = cliValue !== undefined && cliValue !== '';
        const vscodeDefined = vscodeValue !== undefined && vscodeValue !== '';

        if (cliDefined && vscodeDefined) {
            if (cliValue === vscodeValue) {
                diff.matching.push({ key, value: cliValue });
            } else {
                diff.conflicts.push({
                    key,
                    displayName: SETTING_DISPLAY_NAMES[key],
                    cliValue,
                    vscodeValue,
                });
            }
        } else if (cliDefined) {
            diff.cliOnly.push({ key, value: cliValue });
        } else if (vscodeDefined) {
            diff.vscodeOnly.push({ key, value: vscodeValue });
        }
        // If neither defined, we skip (use defaults)
    }

    return diff;
}

/**
 * Check if there are any differences that need syncing
 */
export function hasDifferences(diff: SettingsDiff): boolean {
    return diff.conflicts.length > 0 ||
           diff.cliOnly.length > 0 ||
           diff.vscodeOnly.length > 0;
}

/**
 * Resolve conflicts based on user choices and compute final settings for each target
 *
 * @param diff The diff result from computeSettingsDiff
 * @param choices User's choices for each conflict
 * @param syncUnique Whether to sync settings that only exist in one source to the other
 */
export function resolveConflicts(
    diff: SettingsDiff,
    choices: ConflictChoices,
    syncUnique = true
): ResolvedSettings {
    const cliUpdates: SyncableSettings = {};
    const vscodeUpdates: SyncableSettings = {};

    // Handle conflicts based on user choices
    for (const conflict of diff.conflicts) {
        const choice = choices[conflict.key] || { type: 'skip' };

        switch (choice.type) {
            case 'cli':
                // Use CLI value - update VSCode only
                if (conflict.cliValue !== undefined) {
                    vscodeUpdates[conflict.key] = conflict.cliValue;
                }
                break;
            case 'vscode':
                // Use VSCode value - update CLI only
                if (conflict.vscodeValue !== undefined) {
                    cliUpdates[conflict.key] = conflict.vscodeValue;
                }
                break;
            case 'custom':
                // Use custom value - update both
                cliUpdates[conflict.key] = choice.value;
                vscodeUpdates[conflict.key] = choice.value;
                break;
            case 'skip':
                // Do nothing
                break;
        }
    }

    // Optionally sync unique settings to the other source
    if (syncUnique) {
        for (const { key, value } of diff.cliOnly) {
            vscodeUpdates[key] = value;
        }
        for (const { key, value } of diff.vscodeOnly) {
            cliUpdates[key] = value;
        }
    }

    return {
        cli: cliUpdates,
        vscode: toVSCodeSettings(vscodeUpdates, false),
    };
}

/**
 * Helper to create a "use CLI" resolution
 */
export function useCli(): ConflictResolution {
    return { type: 'cli' };
}

/**
 * Helper to create a "use VSCode" resolution
 */
export function useVSCode(): ConflictResolution {
    return { type: 'vscode' };
}

/**
 * Helper to create a "custom value" resolution
 */
export function useCustom(value: string): ConflictResolution {
    return { type: 'custom', value };
}

/**
 * Helper to create a "skip" resolution
 */
export function skip(): ConflictResolution {
    return { type: 'skip' };
}

/**
 * Format a conflict for display (useful for CLI output)
 */
export function formatConflict(conflict: SettingConflict): string {
    return `${conflict.displayName}:\n  CLI:    "${conflict.cliValue ?? '(not set)'}"\n  VSCode: "${conflict.vscodeValue ?? '(not set)'}"`;
}

/**
 * Get a summary of the diff for display
 */
export function getDiffSummary(diff: SettingsDiff): string {
    const parts: string[] = [];

    if (diff.conflicts.length > 0) {
        parts.push(`${diff.conflicts.length} conflicting setting(s)`);
    }
    if (diff.cliOnly.length > 0) {
        parts.push(`${diff.cliOnly.length} CLI-only setting(s)`);
    }
    if (diff.vscodeOnly.length > 0) {
        parts.push(`${diff.vscodeOnly.length} VSCode-only setting(s)`);
    }
    if (diff.matching.length > 0) {
        parts.push(`${diff.matching.length} matching setting(s)`);
    }

    if (parts.length === 0) {
        return 'No settings to compare';
    }

    return parts.join(', ');
}

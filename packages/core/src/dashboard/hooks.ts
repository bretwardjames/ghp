/**
 * Dashboard Hooks - Registration and management for external content providers
 *
 * External tools register CLI commands that output JSON data to be displayed
 * in the branch dashboard. This allows any tool (in any language) to add
 * custom sections to the dashboard.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// =============================================================================
// Types
// =============================================================================

/**
 * A registered dashboard hook
 */
export interface DashboardHook {
    /** Unique identifier for the hook */
    name: string;
    /** Human-readable display name */
    displayName: string;
    /** CLI command to execute (receives --branch and --repo args) */
    command: string;
    /** Category for grouping in dashboard */
    category: string;
    /** Whether the hook is enabled */
    enabled: boolean;
    /** Maximum execution time in milliseconds (default: 5000) */
    timeout?: number;
}

/**
 * Hook configuration file structure
 */
export interface HooksConfig {
    hooks: DashboardHook[];
}

/**
 * Item returned by a hook
 */
export interface HookItem {
    /** Unique identifier */
    id: string;
    /** Item type (e.g., 'memory', 'document', 'note') */
    type: string;
    /** Item title */
    title: string;
    /** Optional summary/description */
    summary?: string;
    /** Optional timestamp */
    timestamp?: string;
    /** Optional additional metadata */
    metadata?: Record<string, unknown>;
}

/**
 * Response format from hook commands
 */
export interface HookResponse {
    /** Whether the hook executed successfully */
    success: boolean;
    /** Data returned by the hook */
    data?: {
        /** Section title */
        title: string;
        /** Items to display */
        items: HookItem[];
    };
    /** Error message if success is false */
    error?: string;
}

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.config', 'ghp-cli');
const HOOKS_CONFIG_FILE = 'dashboard-hooks.json';

/**
 * Get the path to the hooks configuration file
 */
export function getHooksConfigPath(): string {
    return path.join(DEFAULT_CONFIG_DIR, HOOKS_CONFIG_FILE);
}

/**
 * Ensure the config directory exists
 */
function ensureConfigDir(): void {
    if (!fs.existsSync(DEFAULT_CONFIG_DIR)) {
        fs.mkdirSync(DEFAULT_CONFIG_DIR, { recursive: true });
    }
}

/**
 * Load hooks configuration from disk
 */
export function loadHooksConfig(): HooksConfig {
    const configPath = getHooksConfigPath();

    if (!fs.existsSync(configPath)) {
        return { hooks: [] };
    }

    try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(content) as HooksConfig;

        // Validate and normalize
        if (!config.hooks || !Array.isArray(config.hooks)) {
            return { hooks: [] };
        }

        return {
            hooks: config.hooks.map(normalizeHook).filter(isValidHook),
        };
    } catch (error) {
        console.error(`Failed to load hooks config: ${error}`);
        return { hooks: [] };
    }
}

/**
 * Save hooks configuration to disk
 */
export function saveHooksConfig(config: HooksConfig): void {
    ensureConfigDir();
    const configPath = getHooksConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Normalize a hook to ensure all fields have defaults
 */
function normalizeHook(hook: Partial<DashboardHook>): DashboardHook {
    return {
        name: hook.name || '',
        displayName: hook.displayName || hook.name || '',
        command: hook.command || '',
        category: hook.category || 'other',
        enabled: hook.enabled !== false, // Default to true
        timeout: hook.timeout ?? 5000,
    };
}

/**
 * Validate that a hook has required fields
 */
function isValidHook(hook: DashboardHook): boolean {
    return Boolean(hook.name && hook.command);
}

// =============================================================================
// Hook Management
// =============================================================================

/**
 * Get all registered hooks
 */
export function getHooks(): DashboardHook[] {
    const config = loadHooksConfig();
    return config.hooks;
}

/**
 * Get only enabled hooks
 */
export function getEnabledHooks(): DashboardHook[] {
    return getHooks().filter((hook) => hook.enabled);
}

/**
 * Get a hook by name
 */
export function getHook(name: string): DashboardHook | null {
    const hooks = getHooks();
    return hooks.find((h) => h.name === name) || null;
}

/**
 * Add a new hook
 */
export function addHook(hook: Omit<DashboardHook, 'enabled'> & { enabled?: boolean }): DashboardHook {
    const config = loadHooksConfig();

    // Check for duplicate
    if (config.hooks.some((h) => h.name === hook.name)) {
        throw new Error(`Hook "${hook.name}" already exists`);
    }

    const normalizedHook = normalizeHook(hook);

    if (!isValidHook(normalizedHook)) {
        throw new Error('Hook must have a name and command');
    }

    config.hooks.push(normalizedHook);
    saveHooksConfig(config);

    return normalizedHook;
}

/**
 * Update an existing hook
 */
export function updateHook(name: string, updates: Partial<DashboardHook>): DashboardHook {
    const config = loadHooksConfig();
    const index = config.hooks.findIndex((h) => h.name === name);

    if (index === -1) {
        throw new Error(`Hook "${name}" not found`);
    }

    // Don't allow changing the name to an existing hook's name
    if (updates.name && updates.name !== name) {
        if (config.hooks.some((h) => h.name === updates.name)) {
            throw new Error(`Hook "${updates.name}" already exists`);
        }
    }

    config.hooks[index] = {
        ...config.hooks[index],
        ...updates,
    };

    saveHooksConfig(config);
    return config.hooks[index];
}

/**
 * Remove a hook
 */
export function removeHook(name: string): boolean {
    const config = loadHooksConfig();
    const index = config.hooks.findIndex((h) => h.name === name);

    if (index === -1) {
        return false;
    }

    config.hooks.splice(index, 1);
    saveHooksConfig(config);
    return true;
}

/**
 * Enable a hook
 */
export function enableHook(name: string): DashboardHook {
    return updateHook(name, { enabled: true });
}

/**
 * Disable a hook
 */
export function disableHook(name: string): DashboardHook {
    return updateHook(name, { enabled: false });
}

/**
 * Get hooks grouped by category
 */
export function getHooksByCategory(): Map<string, DashboardHook[]> {
    const hooks = getHooks();
    const byCategory = new Map<string, DashboardHook[]>();

    for (const hook of hooks) {
        const category = hook.category || 'other';
        if (!byCategory.has(category)) {
            byCategory.set(category, []);
        }
        byCategory.get(category)!.push(hook);
    }

    return byCategory;
}

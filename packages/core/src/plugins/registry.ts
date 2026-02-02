/**
 * Event Hooks Registry - Registration and management for ghp event hooks
 *
 * Hooks are stored in ~/.config/ghp-cli/event-hooks.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { EventHook, EventHooksConfig, EventType, HookMode } from './types.js';

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.config', 'ghp-cli');
const EVENT_HOOKS_CONFIG_FILE = 'event-hooks.json';

/**
 * Get the path to the event hooks configuration file
 */
export function getEventHooksConfigPath(): string {
    return path.join(DEFAULT_CONFIG_DIR, EVENT_HOOKS_CONFIG_FILE);
}

/**
 * Ensure the config directory exists
 */
function ensureConfigDir(): void {
    if (!fs.existsSync(DEFAULT_CONFIG_DIR)) {
        fs.mkdirSync(DEFAULT_CONFIG_DIR, { recursive: true });
    }
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Valid event types
 */
const VALID_EVENTS: EventType[] = [
    'issue-created',
    'issue-started',
    'pr-created',
    'pr-merged',
    'worktree-created',
    'worktree-removed',
];

/**
 * Valid hook execution modes
 */
const VALID_MODES: HookMode[] = [
    'fire-and-forget',
    'blocking',
    'interactive',
];

/**
 * Validate hook name: alphanumeric, dash, underscore only
 */
function isValidHookName(name: string): boolean {
    return /^[\w-]+$/.test(name) && name.length > 0 && name.length < 64;
}

/**
 * Validate event type
 */
function isValidEventType(event: string): event is EventType {
    return VALID_EVENTS.includes(event as EventType);
}

/**
 * Validate hook mode
 */
function isValidMode(mode: string): mode is HookMode {
    return VALID_MODES.includes(mode as HookMode);
}

/**
 * Normalize a hook to ensure all fields have defaults
 */
function normalizeHook(hook: Partial<EventHook>): EventHook {
    return {
        name: hook.name || '',
        displayName: hook.displayName || hook.name || '',
        event: hook.event || 'issue-started',
        command: hook.command || '',
        enabled: hook.enabled !== false, // Default to true
        timeout: hook.timeout ?? 30000,
        mode: hook.mode || 'fire-and-forget',
        exitCodes: hook.exitCodes,
        continuePrompt: hook.continuePrompt,
    };
}

/**
 * Validate that a hook has required fields
 */
function isValidHook(hook: EventHook): boolean {
    // Basic required field validation
    if (!isValidHookName(hook.name) || !isValidEventType(hook.event) || !hook.command) {
        return false;
    }

    // Validate mode if present
    if (hook.mode && !isValidMode(hook.mode)) {
        return false;
    }

    // Validate exitCodes structure if present
    if (hook.exitCodes) {
        const { success, abort, warn } = hook.exitCodes;
        const isValidCodeArray = (arr: unknown): boolean =>
            arr === undefined || (Array.isArray(arr) && arr.every((n) => typeof n === 'number'));

        if (!isValidCodeArray(success) || !isValidCodeArray(abort) || !isValidCodeArray(warn)) {
            return false;
        }
    }

    return true;
}

// =============================================================================
// Load/Save Configuration
// =============================================================================

/**
 * Load event hooks configuration from disk
 */
export function loadEventHooksConfig(): EventHooksConfig {
    const configPath = getEventHooksConfigPath();

    if (!fs.existsSync(configPath)) {
        return { hooks: [] };
    }

    try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(content) as EventHooksConfig;

        if (!config.hooks || !Array.isArray(config.hooks)) {
            return { hooks: [] };
        }

        return {
            hooks: config.hooks.map(normalizeHook).filter(isValidHook),
        };
    } catch (error) {
        console.error(`Failed to load event hooks config: ${error}`);
        return { hooks: [] };
    }
}

/**
 * Save event hooks configuration to disk
 */
export function saveEventHooksConfig(config: EventHooksConfig): void {
    ensureConfigDir();
    const configPath = getEventHooksConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    // Ensure restricted permissions (user read/write only)
    try {
        fs.chmodSync(configPath, 0o600);
    } catch {
        // Ignore chmod errors (e.g., on Windows)
    }
}

// =============================================================================
// Hook Management
// =============================================================================

/**
 * Get all registered hooks
 */
export function getEventHooks(): EventHook[] {
    const config = loadEventHooksConfig();
    return config.hooks;
}

/**
 * Get only enabled hooks
 */
export function getEnabledEventHooks(): EventHook[] {
    return getEventHooks().filter((hook) => hook.enabled);
}

/**
 * Get a hook by name
 */
export function getEventHook(name: string): EventHook | null {
    const hooks = getEventHooks();
    return hooks.find((h) => h.name === name) || null;
}

/**
 * Get hooks for a specific event
 */
export function getHooksForEvent(event: EventType): EventHook[] {
    return getEnabledEventHooks().filter((hook) => hook.event === event);
}

/**
 * Add a new hook
 */
export function addEventHook(hook: Omit<EventHook, 'enabled'> & { enabled?: boolean }): EventHook {
    const config = loadEventHooksConfig();

    // Check for duplicate
    if (config.hooks.some((h) => h.name === hook.name)) {
        throw new Error(`Hook "${hook.name}" already exists`);
    }

    const normalizedHook = normalizeHook(hook);

    if (!isValidHookName(normalizedHook.name)) {
        throw new Error('Hook name must contain only letters, numbers, dashes, and underscores');
    }

    if (!isValidEventType(normalizedHook.event)) {
        throw new Error(`Invalid event type: ${normalizedHook.event}. Valid events: ${VALID_EVENTS.join(', ')}`);
    }

    if (normalizedHook.mode && !isValidMode(normalizedHook.mode)) {
        throw new Error(`Invalid mode: ${normalizedHook.mode}. Valid modes: ${VALID_MODES.join(', ')}`);
    }

    if (!normalizedHook.command) {
        throw new Error('Hook must have a command');
    }

    config.hooks.push(normalizedHook);
    saveEventHooksConfig(config);

    return normalizedHook;
}

/**
 * Update an existing hook
 */
export function updateEventHook(name: string, updates: Partial<EventHook>): EventHook {
    const config = loadEventHooksConfig();
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

    // Validate event type if provided
    if (updates.event && !isValidEventType(updates.event)) {
        throw new Error(`Invalid event type: ${updates.event}. Valid events: ${VALID_EVENTS.join(', ')}`);
    }

    // Validate mode if provided
    if (updates.mode && !isValidMode(updates.mode)) {
        throw new Error(`Invalid mode: ${updates.mode}. Valid modes: ${VALID_MODES.join(', ')}`);
    }

    config.hooks[index] = {
        ...config.hooks[index],
        ...updates,
    };

    saveEventHooksConfig(config);
    return config.hooks[index];
}

/**
 * Remove a hook
 */
export function removeEventHook(name: string): boolean {
    const config = loadEventHooksConfig();
    const index = config.hooks.findIndex((h) => h.name === name);

    if (index === -1) {
        return false;
    }

    config.hooks.splice(index, 1);
    saveEventHooksConfig(config);
    return true;
}

/**
 * Enable a hook
 */
export function enableEventHook(name: string): EventHook {
    return updateEventHook(name, { enabled: true });
}

/**
 * Disable a hook
 */
export function disableEventHook(name: string): EventHook {
    return updateEventHook(name, { enabled: false });
}

/**
 * Get list of valid event types
 */
export function getValidEventTypes(): EventType[] {
    return [...VALID_EVENTS];
}

/**
 * Get list of valid hook modes
 */
export function getValidModes(): HookMode[] {
    return [...VALID_MODES];
}

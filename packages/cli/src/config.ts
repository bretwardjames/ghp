import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import {
    type SyncableSettings,
    type SyncableSettingKey,
    VSCODE_TO_CLI_MAP,
    CLI_TO_VSCODE_MAP,
} from '@bretwardjames/ghp-core';

// User config (personal overrides)
const USER_CONFIG_DIR = join(homedir(), '.config', 'ghp-cli');
const USER_CONFIG_FILE = join(USER_CONFIG_DIR, 'config.json');

// Workspace config filename (in repo root)
const WORKSPACE_CONFIG_DIR = '.ghp';
const WORKSPACE_CONFIG_FILE = 'config.json';

export interface PlanShortcut {
    status?: string | string[];
    mine?: boolean;
    unassigned?: boolean;
    slice?: string[];
    project?: string;
    sort?: string;
    list?: boolean;
    all?: boolean;
    group?: string;
}

export interface WorkDefaults {
    status?: string | string[];
    mine?: boolean;
    unassigned?: boolean;
    slice?: string[];
    project?: string;
    sort?: string;
    list?: boolean;
    all?: boolean;
    group?: string;
    // work-specific
    hideDone?: boolean;
}

export interface ParallelWorkConfig {
    /** Terminal emulator to use (e.g., 'ghostty', 'gnome-terminal', 'tmux') */
    terminal?: string;
    /** Whether to open a terminal by default with --parallel (default: true) */
    openTerminal?: boolean;
    /** Whether to auto-run Claude in the new terminal (default: true) */
    autoRunClaude?: boolean;
    /** Claude slash command to run (default: 'ghp-start', set to empty string to use fallback prompt) */
    claudeCommand?: string;
    /** Whether to auto-resume previous Claude sessions when switching to worktree (default: true) */
    autoResume?: boolean;
    /** Tmux-specific configuration (used when terminal is 'tmux' or auto-detected inside tmux) */
    tmux?: {
        /** Whether to spawn a new window or split the current window into a pane */
        mode?: 'window' | 'pane';
        /** Direction to split when mode is 'pane' */
        paneDirection?: 'horizontal' | 'vertical';
    };
}

/**
 * MCP tool category configuration
 */
export interface McpToolsConfig {
    /** Enable read-only tools (get_my_work, get_project_board) */
    read?: boolean;
    /** Enable action tools (move, done, start, add-issue, etc.) */
    action?: boolean;
}

/**
 * MCP server configuration
 */
export interface McpConfig {
    /** Category-level tool toggles (default: all enabled) */
    tools?: McpToolsConfig;
    /** Array of specific tool names to disable */
    disabledTools?: string[];
}

/**
 * Claude AI configuration
 */
export interface ClaudeConfig {
    /** Auth mode: 'api' (direct API key) or 'cli' (use Claude Code CLI) */
    auth?: 'api' | 'cli';
    /** Anthropic API key (can also use ANTHROPIC_API_KEY env var) */
    apiKey?: string;
    /** Model to use (default: claude-sonnet-4-20250514) */
    model?: string;
    /** Max tokens for responses (default: 4096) */
    maxTokens?: number;
}

export interface Config {
    // General settings
    mainBranch: string;
    branchPattern: string;
    startWorkingStatus: string;
    doneStatus: string;

    // Display settings
    columns?: string;  // comma-separated column names: number,type,title,assignees,status,priority,size,labels,project,repository

    // Worktree settings for parallel work mode
    worktreePath?: string;           // Base path for worktrees (default: ~/.ghp/worktrees)
    worktreeCopyFiles?: string[];    // Files to copy to new worktrees (default: ['.env', '.env.local'])
    worktreeSetupCommand?: string;   // Command to run in new worktrees (default: 'pnpm install')
    worktreeAutoSetup?: boolean;     // Whether to run setup automatically (default: true)

    // Parallel work terminal settings
    parallelWork?: ParallelWorkConfig;

    // MCP server configuration
    mcp?: McpConfig;

    // Claude AI configuration
    claude?: ClaudeConfig;

    // Command defaults
    defaults?: {
        plan?: PlanShortcut;
        work?: WorkDefaults;
        addIssue?: {
            template?: string;  // default template name from .github/ISSUE_TEMPLATE/
            project?: string;   // default project
            status?: string;    // default initial status
        };
    };

    // Named shortcuts for plan command
    shortcuts?: {
        [name: string]: PlanShortcut;
    };
}

const DEFAULT_CONFIG: Config = {
    mainBranch: 'main',
    branchPattern: '{user}/{number}-{title}',
    startWorkingStatus: 'In Progress',
    doneStatus: 'Done',
    // Worktree defaults
    worktreePath: '~/.ghp/worktrees',
    worktreeCopyFiles: ['.env', '.env.local'],
    worktreeSetupCommand: 'pnpm install',
    worktreeAutoSetup: true,
    // Parallel work defaults
    parallelWork: {
        openTerminal: true,
        autoRunClaude: true,
    },
    defaults: {},
    shortcuts: {},
    // MCP defaults (all tools enabled)
    mcp: {
        tools: {
            read: true,
            action: true,
        },
        disabledTools: [],
    },
};

/**
 * Get the git repository root directory
 */
function getRepoRoot(): string | null {
    try {
        return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
    } catch {
        return null;
    }
}

/**
 * Get the workspace config file path (in repo root)
 */
export function getWorkspaceConfigPath(): string | null {
    const repoRoot = getRepoRoot();
    if (!repoRoot) return null;
    return join(repoRoot, WORKSPACE_CONFIG_DIR, WORKSPACE_CONFIG_FILE);
}

/**
 * Load workspace config from .ghp/config.json in repo root
 */
function loadWorkspaceConfig(): Partial<Config> {
    const configPath = getWorkspaceConfigPath();
    if (!configPath) return {};

    try {
        if (existsSync(configPath)) {
            const data = readFileSync(configPath, 'utf-8');
            return JSON.parse(data);
        }
    } catch {
        // Ignore errors
    }
    return {};
}

/**
 * Load user config from ~/.config/ghp-cli/config.json
 */
function loadUserConfig(): Partial<Config> {
    try {
        if (existsSync(USER_CONFIG_FILE)) {
            const data = readFileSync(USER_CONFIG_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch {
        // Ignore errors
    }
    return {};
}

/**
 * Deep merge two config objects (right overwrites left, but nested objects are merged)
 */
function deepMerge(base: Config, override: Partial<Config>): Config {
    const result: Record<string, unknown> = { ...base };
    for (const [key, overrideValue] of Object.entries(override)) {
        if (overrideValue === undefined) continue;

        const baseValue = result[key];
        if (
            typeof overrideValue === 'object' &&
            overrideValue !== null &&
            !Array.isArray(overrideValue) &&
            typeof baseValue === 'object' &&
            baseValue !== null &&
            !Array.isArray(baseValue)
        ) {
            // Deep merge nested objects (defaults, shortcuts)
            result[key] = { ...baseValue as object, ...overrideValue };
        } else {
            // Direct override for primitives and arrays
            result[key] = overrideValue;
        }
    }
    return result as unknown as Config;
}

/**
 * Load merged config: defaults → workspace → user
 * User settings override workspace, workspace overrides defaults
 */
export function loadConfig(): Config {
    const workspaceConfig = loadWorkspaceConfig();
    const userConfig = loadUserConfig();

    // Merge: defaults → workspace → user
    const merged = deepMerge(deepMerge(DEFAULT_CONFIG, workspaceConfig), userConfig);
    return merged;
}

export type ConfigScope = 'user' | 'workspace';

// =============================================================================
// Dotted Path Helpers
// =============================================================================

/**
 * Get a value from an object using a dotted path (e.g., "mcp.tools.workflows")
 */
export function getByPath(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        if (typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
    }

    return current;
}

/**
 * Set a value in an object using a dotted path (e.g., "mcp.tools.workflows")
 * Creates intermediate objects as needed.
 */
export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (current[part] === undefined || current[part] === null) {
            current[part] = {};
        }
        current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
}

/**
 * Parse a value string into the appropriate type
 */
export function parseValue(value: string): unknown {
    // Boolean
    if (value === 'true') return true;
    if (value === 'false') return false;

    // Number
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== '') return num;

    // Array (comma-separated)
    if (value.includes(',')) {
        return value.split(',').map(v => v.trim());
    }

    // String
    return value;
}

/**
 * Get a config value using a dotted path
 */
export function getConfigByPath(path: string): unknown {
    const config = loadConfig();
    return getByPath(config as unknown as Record<string, unknown>, path);
}

/**
 * Set a config value using a dotted path
 */
export function setConfigByPath(path: string, value: unknown, scope: ConfigScope = 'user'): void {
    const scopeConfig = scope === 'workspace' ? loadWorkspaceConfig() : loadUserConfig();
    setByPath(scopeConfig as Record<string, unknown>, path, value);

    if (scope === 'workspace') {
        const repoRoot = getRepoRoot();
        if (!repoRoot) {
            throw new Error('Not in a git repository');
        }
        const configDir = join(repoRoot, WORKSPACE_CONFIG_DIR);
        const configPath = join(configDir, WORKSPACE_CONFIG_FILE);

        if (!existsSync(configDir)) {
            mkdirSync(configDir, { recursive: true });
        }
        writeFileSync(configPath, JSON.stringify(scopeConfig, null, 2));
    } else {
        if (!existsSync(USER_CONFIG_DIR)) {
            mkdirSync(USER_CONFIG_DIR, { recursive: true });
        }
        writeFileSync(USER_CONFIG_FILE, JSON.stringify(scopeConfig, null, 2));
    }
}

/**
 * Get a section of config (e.g., "mcp" returns the whole mcp object)
 */
export function getConfigSection(section: string, scope?: ConfigScope): unknown {
    if (scope === 'workspace') {
        const config = loadWorkspaceConfig();
        return getByPath(config as Record<string, unknown>, section);
    } else if (scope === 'user') {
        const config = loadUserConfig();
        return getByPath(config as Record<string, unknown>, section);
    } else {
        // Merged config
        const config = loadConfig();
        return getByPath(config as unknown as Record<string, unknown>, section);
    }
}

/**
 * Save config to the specified scope
 * @param config The config values to save
 * @param scope 'user' (default) or 'workspace'
 */
export function saveConfig(config: Partial<Config>, scope: ConfigScope = 'user'): void {
    if (scope === 'workspace') {
        const repoRoot = getRepoRoot();
        if (!repoRoot) {
            throw new Error('Not in a git repository');
        }
        const configDir = join(repoRoot, WORKSPACE_CONFIG_DIR);
        const configPath = join(configDir, WORKSPACE_CONFIG_FILE);

        // Load existing workspace config and merge
        const existing = loadWorkspaceConfig();
        const merged = deepMerge(existing as Config, config);

        if (!existsSync(configDir)) {
            mkdirSync(configDir, { recursive: true });
        }
        writeFileSync(configPath, JSON.stringify(merged, null, 2));
    } else {
        // User config
        const existing = loadUserConfig();
        const merged = deepMerge(existing as Config, config);

        if (!existsSync(USER_CONFIG_DIR)) {
            mkdirSync(USER_CONFIG_DIR, { recursive: true });
        }
        writeFileSync(USER_CONFIG_FILE, JSON.stringify(merged, null, 2));
    }
}

export function getConfig<K extends keyof Config>(key: K): Config[K] {
    const config = loadConfig();
    return config[key];
}

/**
 * Get the MCP configuration with defaults applied
 */
export function getMcpConfig(): McpConfig {
    const config = loadConfig();
    const defaultMcp = DEFAULT_CONFIG.mcp!;
    const userMcp = config.mcp || {};

    return {
        tools: {
            ...defaultMcp.tools,
            ...userMcp.tools,
        },
        disabledTools: userMcp.disabledTools || defaultMcp.disabledTools || [],
    };
}

export function setConfig<K extends keyof Config>(key: K, value: Config[K], scope: ConfigScope = 'user'): void {
    saveConfig({ [key]: value }, scope);
}

/**
 * Resolved Claude configuration with defaults
 */
export interface ResolvedClaudeConfig {
    /** Explicit auth mode from config (if set) */
    authMode: 'api' | 'cli' | undefined;
    /** API key (from env or config) */
    apiKey: string | undefined;
    /** Model to use */
    model: string;
    /** Max tokens */
    maxTokens: number;
}

const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_CLAUDE_MAX_TOKENS = 4096;

/**
 * Get the Claude configuration with defaults applied.
 * Also checks ANTHROPIC_API_KEY environment variable.
 */
export function getClaudeConfig(): ResolvedClaudeConfig {
    const config = loadConfig();
    const claudeConfig = config.claude || {};

    return {
        authMode: claudeConfig.auth,
        apiKey: process.env.ANTHROPIC_API_KEY || claudeConfig.apiKey,
        model: claudeConfig.model || DEFAULT_CLAUDE_MODEL,
        maxTokens: claudeConfig.maxTokens || DEFAULT_CLAUDE_MAX_TOKENS,
    };
}

export function getShortcut(name: string): PlanShortcut | undefined {
    const config = loadConfig();
    return config.shortcuts?.[name];
}

export function setShortcut(name: string, shortcut: PlanShortcut): void {
    const config = loadConfig();
    const shortcuts = { ...config.shortcuts, [name]: shortcut };
    saveConfig({ shortcuts });
}

export function deleteShortcut(name: string): void {
    const config = loadConfig();
    if (config.shortcuts) {
        delete config.shortcuts[name];
        saveConfig({ shortcuts: config.shortcuts });
    }
}

export function listShortcuts(): Record<string, PlanShortcut> {
    const config = loadConfig();
    return config.shortcuts || {};
}

export function getPlanDefaults(): PlanShortcut {
    const config = loadConfig();
    return config.defaults?.plan || {};
}

export function getWorkDefaults(): WorkDefaults {
    const config = loadConfig();
    return config.defaults?.work || {};
}

export function setPlanDefaults(defaults: PlanShortcut): void {
    const config = loadConfig();
    saveConfig({
        defaults: { ...config.defaults, plan: defaults }
    });
}

export function getConfigPath(scope?: ConfigScope): string {
    if (scope === 'workspace') {
        const path = getWorkspaceConfigPath();
        return path || '(not in a git repository)';
    }
    return USER_CONFIG_FILE;
}

export function getUserConfigPath(): string {
    return USER_CONFIG_FILE;
}

export function getAddIssueDefaults(): { template?: string; project?: string; status?: string } {
    const config = loadConfig();
    return config.defaults?.addIssue || {};
}

export const CONFIG_KEYS = ['mainBranch', 'branchPattern', 'startWorkingStatus', 'doneStatus', 'columns', 'worktreePath', 'worktreeCopyFiles', 'worktreeSetupCommand', 'worktreeAutoSetup', 'parallelWork'] as const;

export type ConfigSource = 'default' | 'workspace' | 'user';

export interface ConfigValueWithSource {
    value: string | undefined;
    source: ConfigSource;
}

export function listConfig(): Record<string, string | string[] | boolean | undefined> {
    const config = loadConfig();
    return {
        mainBranch: config.mainBranch,
        branchPattern: config.branchPattern,
        startWorkingStatus: config.startWorkingStatus,
        doneStatus: config.doneStatus,
        worktreePath: config.worktreePath,
        worktreeCopyFiles: config.worktreeCopyFiles,
        worktreeSetupCommand: config.worktreeSetupCommand,
        worktreeAutoSetup: config.worktreeAutoSetup,
    };
}

export interface WorktreeConfig {
    path: string;
    copyFiles: string[];
    setupCommand: string;
    autoSetup: boolean;
}

/**
 * Get the worktree configuration with defaults applied
 */
export function getWorktreeConfig(): WorktreeConfig {
    const config = loadConfig();
    return {
        path: config.worktreePath ?? DEFAULT_CONFIG.worktreePath!,
        copyFiles: config.worktreeCopyFiles ?? DEFAULT_CONFIG.worktreeCopyFiles!,
        setupCommand: config.worktreeSetupCommand ?? DEFAULT_CONFIG.worktreeSetupCommand!,
        autoSetup: config.worktreeAutoSetup ?? DEFAULT_CONFIG.worktreeAutoSetup!,
    };
}

export interface ResolvedParallelWorkConfig {
    terminal?: string;
    openTerminal: boolean;
    autoRunClaude: boolean;
    claudeCommand?: string;
    autoResume: boolean;
}

/**
 * Get the parallel work configuration with defaults applied
 */
export function getParallelWorkConfig(): ResolvedParallelWorkConfig {
    const config = loadConfig();
    const parallelWork = config.parallelWork ?? {};
    return {
        terminal: parallelWork.terminal,
        openTerminal: parallelWork.openTerminal ?? true,
        autoRunClaude: parallelWork.autoRunClaude ?? true,
        claudeCommand: parallelWork.claudeCommand,
        autoResume: parallelWork.autoResume ?? true,
    };
}

/**
 * List simple config values with their source (default, workspace, or user)
 */
export function listConfigWithSources(): Record<string, ConfigValueWithSource> {
    const userConfig = loadUserConfig();
    const workspaceConfig = loadWorkspaceConfig();

    const result: Record<string, ConfigValueWithSource> = {};

    for (const key of CONFIG_KEYS) {
        if (userConfig[key] !== undefined) {
            result[key] = { value: userConfig[key] as string, source: 'user' };
        } else if (workspaceConfig[key] !== undefined) {
            result[key] = { value: workspaceConfig[key] as string, source: 'workspace' };
        } else {
            result[key] = { value: DEFAULT_CONFIG[key] as string | undefined, source: 'default' };
        }
    }

    return result;
}

export interface FullConfigWithSources {
    settings: Record<string, ConfigValueWithSource>;
    defaults: {
        plan: { value: PlanShortcut; source: ConfigSource };
        addIssue: { value: { template?: string; project?: string; status?: string }; source: ConfigSource };
    };
    shortcuts: Record<string, { value: PlanShortcut; source: ConfigSource }>;
}

/**
 * Get full config with sources for all sections
 */
export function getFullConfigWithSources(): FullConfigWithSources {
    const userConfig = loadUserConfig();
    const workspaceConfig = loadWorkspaceConfig();
    const mergedConfig = loadConfig();

    // Simple settings
    const settings: Record<string, ConfigValueWithSource> = {};
    for (const key of CONFIG_KEYS) {
        if (userConfig[key] !== undefined) {
            settings[key] = { value: userConfig[key] as string, source: 'user' };
        } else if (workspaceConfig[key] !== undefined) {
            settings[key] = { value: workspaceConfig[key] as string, source: 'workspace' };
        } else {
            settings[key] = { value: DEFAULT_CONFIG[key] as string | undefined, source: 'default' };
        }
    }

    // Defaults - plan
    let planSource: ConfigSource = 'default';
    if (userConfig.defaults?.plan) planSource = 'user';
    else if (workspaceConfig.defaults?.plan) planSource = 'workspace';

    // Defaults - addIssue
    let addIssueSource: ConfigSource = 'default';
    if (userConfig.defaults?.addIssue) addIssueSource = 'user';
    else if (workspaceConfig.defaults?.addIssue) addIssueSource = 'workspace';

    // Shortcuts - track source per shortcut
    const shortcuts: Record<string, { value: PlanShortcut; source: ConfigSource }> = {};
    const allShortcutNames = new Set([
        ...Object.keys(workspaceConfig.shortcuts || {}),
        ...Object.keys(userConfig.shortcuts || {}),
    ]);
    for (const name of allShortcutNames) {
        // User overrides workspace
        if (userConfig.shortcuts?.[name]) {
            shortcuts[name] = { value: userConfig.shortcuts[name], source: 'user' };
        } else if (workspaceConfig.shortcuts?.[name]) {
            shortcuts[name] = { value: workspaceConfig.shortcuts[name], source: 'workspace' };
        }
    }

    return {
        settings,
        defaults: {
            plan: { value: mergedConfig.defaults?.plan || {}, source: planSource },
            addIssue: { value: mergedConfig.defaults?.addIssue || {}, source: addIssueSource },
        },
        shortcuts,
    };
}

// VS Code / Cursor settings paths
function getVSCodeUserSettingsPath(editor: 'code' | 'cursor' = 'code'): string {
    const home = homedir();
    const appName = editor === 'cursor' ? 'Cursor' : 'Code';

    switch (platform()) {
        case 'darwin':
            return join(home, 'Library', 'Application Support', appName, 'User', 'settings.json');
        case 'win32':
            return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), appName, 'User', 'settings.json');
        default: // linux
            return join(home, '.config', appName, 'User', 'settings.json');
    }
}

function getVSCodeWorkspaceSettingsPath(): string | null {
    const repoRoot = getRepoRoot();
    if (!repoRoot) return null;
    return join(repoRoot, '.vscode', 'settings.json');
}

/**
 * Strip JSON comments (single-line // and multi-line) to parse JSONC
 */
function stripJsonComments(jsonc: string): string {
    let result = '';
    let inString = false;
    let inSingleLineComment = false;
    let inMultiLineComment = false;

    for (let i = 0; i < jsonc.length; i++) {
        const char = jsonc[i];
        const next = jsonc[i + 1];

        if (inSingleLineComment) {
            if (char === '\n') {
                inSingleLineComment = false;
                result += char;
            }
            continue;
        }

        if (inMultiLineComment) {
            if (char === '*' && next === '/') {
                inMultiLineComment = false;
                i++; // skip the /
            }
            continue;
        }

        if (inString) {
            result += char;
            if (char === '\\' && next) {
                result += next;
                i++;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            result += char;
            continue;
        }

        if (char === '/' && next === '/') {
            inSingleLineComment = true;
            i++;
            continue;
        }

        if (char === '/' && next === '*') {
            inMultiLineComment = true;
            i++;
            continue;
        }

        result += char;
    }

    return result;
}

export interface VSCodeSettingsResult {
    workspace: Record<string, unknown>;
    user: Record<string, unknown>;
    errors: string[];
}

/**
 * Read VS Code/Cursor settings and extract ghProjects.* values
 */
function readVSCodeSettings(editor: 'code' | 'cursor' = 'code'): VSCodeSettingsResult {
    const result: VSCodeSettingsResult = {
        workspace: {},
        user: {},
        errors: [],
    };

    // Read workspace settings
    const workspacePath = getVSCodeWorkspaceSettingsPath();
    if (workspacePath && existsSync(workspacePath)) {
        try {
            const content = readFileSync(workspacePath, 'utf-8');
            const parsed = JSON.parse(stripJsonComments(content));
            for (const [key, value] of Object.entries(parsed)) {
                if (key.startsWith('ghProjects.')) {
                    result.workspace[key.replace('ghProjects.', '')] = value;
                }
            }
        } catch (err) {
            result.errors.push(`Failed to parse workspace settings: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    }

    // Read user settings
    const userPath = getVSCodeUserSettingsPath(editor);
    if (existsSync(userPath)) {
        try {
            const content = readFileSync(userPath, 'utf-8');
            const parsed = JSON.parse(stripJsonComments(content));
            for (const [key, value] of Object.entries(parsed)) {
                if (key.startsWith('ghProjects.')) {
                    result.user[key.replace('ghProjects.', '')] = value;
                }
            }
        } catch (err) {
            result.errors.push(`Failed to parse ${editor} user settings: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    }

    return result;
}

// VSCODE_TO_CLI_MAP is now imported from @bretwardjames/ghp-core

export interface SyncResult {
    synced: Array<{ key: string; value: string; source: 'workspace' | 'user' }>;
    skipped: string[];
    errors: string[];
    editor: string;
}

/**
 * Sync VS Code/Cursor settings to CLI config
 */
export function syncFromVSCode(targetScope: ConfigScope = 'user'): SyncResult {
    // Try Cursor first, fall back to Code
    let editor: 'cursor' | 'code' = 'cursor';
    let vscodeSettings = readVSCodeSettings('cursor');
    const allErrors: string[] = [...vscodeSettings.errors];

    // If no Cursor settings found, try VS Code
    if (Object.keys(vscodeSettings.workspace).length === 0 && Object.keys(vscodeSettings.user).length === 0) {
        editor = 'code';
        vscodeSettings = readVSCodeSettings('code');
        allErrors.push(...vscodeSettings.errors);
    }

    const result: SyncResult = {
        synced: [],
        skipped: [],
        errors: allErrors,
        editor: editor === 'cursor' ? 'Cursor' : 'VS Code',
    };

    // Merge workspace and user (user overrides workspace, like VS Code does)
    const merged = { ...vscodeSettings.workspace, ...vscodeSettings.user };

    // Track sources for reporting
    const sources: Record<string, 'workspace' | 'user'> = {};
    for (const key of Object.keys(vscodeSettings.workspace)) {
        sources[key] = 'workspace';
    }
    for (const key of Object.keys(vscodeSettings.user)) {
        sources[key] = 'user';
    }

    // Map and save each setting
    const configUpdates: Partial<Config> = {};

    for (const [vscodeKey, cliKey] of Object.entries(VSCODE_TO_CLI_MAP)) {
        if (merged[vscodeKey] !== undefined) {
            const value = merged[vscodeKey];
            if (typeof value === 'string') {
                (configUpdates as Record<string, unknown>)[cliKey] = value;
                result.synced.push({
                    key: cliKey,
                    value,
                    source: sources[vscodeKey],
                });
            }
        }
    }

    // Report skipped settings (VS Code settings that don't map to CLI)
    for (const key of Object.keys(merged)) {
        if (!VSCODE_TO_CLI_MAP[key]) {
            result.skipped.push(key);
        }
    }

    // Save to CLI config
    if (Object.keys(configUpdates).length > 0) {
        saveConfig(configUpdates, targetScope);
    }

    return result;
}

export function getVSCodeSettingsPaths(): { workspace: string | null; cursorUser: string; codeUser: string } {
    return {
        workspace: getVSCodeWorkspaceSettingsPath(),
        cursorUser: getVSCodeUserSettingsPath('cursor'),
        codeUser: getVSCodeUserSettingsPath('code'),
    };
}

// =============================================================================
// Bidirectional Sync Support
// =============================================================================

/**
 * Get CLI config as SyncableSettings (only the 4 syncable keys)
 */
export function getCliSyncableSettings(): SyncableSettings {
    const config = loadConfig();
    return {
        mainBranch: config.mainBranch,
        branchPattern: config.branchPattern,
        startWorkingStatus: config.startWorkingStatus,
        doneStatus: config.doneStatus,
    };
}

/**
 * Read and merge VSCode/Cursor settings, returning as SyncableSettings.
 * Tries Cursor first, then VS Code.
 * Returns the settings and which editor was used.
 */
export function getVSCodeSyncableSettings(): {
    settings: SyncableSettings;
    editor: 'cursor' | 'code';
    errors: string[];
} {
    // Try Cursor first
    let editor: 'cursor' | 'code' = 'cursor';
    let vscodeResult = readVSCodeSettings('cursor');
    const errors: string[] = [...vscodeResult.errors];

    // If no Cursor settings found, try VS Code
    if (Object.keys(vscodeResult.workspace).length === 0 && Object.keys(vscodeResult.user).length === 0) {
        editor = 'code';
        vscodeResult = readVSCodeSettings('code');
        errors.push(...vscodeResult.errors);
    }

    // Merge workspace and user (user overrides workspace)
    const merged = { ...vscodeResult.workspace, ...vscodeResult.user };

    // Convert to SyncableSettings using CLI key names
    const settings: SyncableSettings = {};
    for (const [vscodeKey, cliKey] of Object.entries(VSCODE_TO_CLI_MAP)) {
        const value = merged[vscodeKey];
        if (typeof value === 'string' && value.trim() !== '') {
            settings[cliKey] = value;
        }
    }

    return { settings, editor, errors };
}

/**
 * Write settings to VSCode/Cursor settings file.
 * Preserves existing settings and only updates ghProjects.* keys.
 */
export function writeToVSCode(
    settings: Record<string, string>,
    editor: 'cursor' | 'code' = 'cursor',
    scope: 'user' | 'workspace' = 'user'
): { success: boolean; error?: string; path: string } {
    const settingsPath = scope === 'workspace'
        ? getVSCodeWorkspaceSettingsPath()
        : getVSCodeUserSettingsPath(editor);

    if (!settingsPath) {
        return { success: false, error: 'Not in a git repository', path: '' };
    }

    try {
        // Read existing settings
        let existing: Record<string, unknown> = {};
        if (existsSync(settingsPath)) {
            const content = readFileSync(settingsPath, 'utf-8');
            existing = JSON.parse(stripJsonComments(content));
        }

        // Update ghProjects.* settings
        for (const [vscodeKey, value] of Object.entries(settings)) {
            existing[`ghProjects.${vscodeKey}`] = value;
        }

        // Write back
        const dir = join(settingsPath, '..');
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        writeFileSync(settingsPath, JSON.stringify(existing, null, 2));

        return { success: true, path: settingsPath };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
            path: settingsPath,
        };
    }
}

// Re-export types from core for convenience
export type { SyncableSettings, SyncableSettingKey };

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from './server.js';
import type { ToolCategory, ToolCapability, McpConfig, McpToolsConfig } from './types.js';
import type { OnFailureBehavior } from '@bretwardjames/ghp-core';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

// Import tools with their metadata
import * as workTool from './tools/work.js';
import * as planTool from './tools/plan.js';
import * as moveTool from './tools/move.js';
import * as doneTool from './tools/done.js';
import * as startTool from './tools/start.js';
import * as addIssueTool from './tools/add-issue.js';
import * as updateIssueTool from './tools/update-issue.js';
import * as assignTool from './tools/assign.js';
import * as commentTool from './tools/comment.js';
import * as setFieldTool from './tools/set-field.js';
import * as worktreeTool from './tools/worktree.js';
// Phase 1: High Priority Tools
import * as createPrTool from './tools/create-pr.js';
import * as mergePrTool from './tools/merge-pr.js';
import * as syncMergedTool from './tools/sync-merged.js';
import * as releaseTool from './tools/release.js';
import * as listWorktreesTool from './tools/list-worktrees.js';
import * as removeWorktreeTool from './tools/remove-worktree.js';
import * as stopWorkTool from './tools/stop-work.js';
// Phase 2: Medium Priority Tools
import * as setParentTool from './tools/set-parent.js';
import * as addLabelTool from './tools/add-label.js';
import * as removeLabelTool from './tools/remove-label.js';
import * as getProgressTool from './tools/get-progress.js';
import * as linkBranchTool from './tools/link-branch.js';
import * as unlinkBranchTool from './tools/unlink-branch.js';
// Phase 3: Lower Priority Tools
import * as getIssueTool from './tools/get-issue.js';
import * as standupTool from './tools/standup.js';
import * as fieldsTool from './tools/fields.js';
import * as tagsTool from './tools/tags.js';
// Planning meeting driver
import * as planningAuditTool from './tools/planning-audit.js';
import * as planningStartTool from './tools/planning-start.js';
import * as planningNextTool from './tools/planning-next.js';
import * as planningDecideTool from './tools/planning-decide.js';
import * as planningParkTool from './tools/planning-park.js';
import * as planningStatusTool from './tools/planning-status.js';
import * as planningEndTool from './tools/planning-end.js';

// Re-export types
export type { ToolCategory, ToolCapability, McpConfig, McpToolsConfig } from './types.js';

/**
 * Tool module with metadata and registration function
 */
interface ToolModule {
    meta: {
        name: string;
        category: ToolCategory;
        capability: ToolCapability;
        disabledByDefault?: boolean;
    };
    register: (server: McpServer, context: ServerContext) => void;
}

/**
 * All available tools collected from individual modules
 */
const TOOLS: ToolModule[] = [
    // Read tools
    workTool,
    planTool,
    listWorktreesTool,
    getProgressTool,
    getIssueTool,
    standupTool,
    fieldsTool,
    tagsTool,
    // Action tools
    moveTool,
    doneTool,
    startTool,
    stopWorkTool,
    addIssueTool,
    updateIssueTool,
    assignTool,
    commentTool,
    setFieldTool,
    addLabelTool,
    removeLabelTool,
    setParentTool,
    linkBranchTool,
    unlinkBranchTool,
    // PR tools
    createPrTool,
    mergePrTool,
    syncMergedTool,
    releaseTool,
    // Worktree tools
    worktreeTool,
    removeWorktreeTool,
    // Planning — readiness + stateful meeting driver
    planningAuditTool,
    planningStartTool,
    planningNextTool,
    planningDecideTool,
    planningParkTool,
    planningStatusTool,
    planningEndTool,
];

/**
 * Default configuration when none is specified
 */
const DEFAULT_MCP_CONFIG: McpConfig = {
    tools: {
        read: true,
        action: true,
    },
    disabledTools: [],
};

/**
 * Get the git repository root directory
 */
function getRepoRoot(): string | null {
    try {
        return execSync('git rev-parse --show-toplevel', {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
    } catch {
        return null;
    }
}

/**
 * Strip JSON comments (line comments and block comments) from a string
 */
function stripJsonComments(json: string): string {
    return json
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*/g, '');
}

/**
 * Load and parse a JSON config file
 */
function loadConfigFile(path: string): Record<string, unknown> | null {
    if (!existsSync(path)) {
        return null;
    }
    try {
        const content = readFileSync(path, 'utf-8');
        return JSON.parse(stripJsonComments(content));
    } catch {
        return null;
    }
}

/**
 * Load MCP configuration from user and workspace config files
 * Workspace config takes precedence over user config
 */
export function loadMcpConfig(): McpConfig {
    // User config: ~/.config/ghp-cli/config.json
    const userConfigPath = join(homedir(), '.config', 'ghp-cli', 'config.json');
    const userConfig = loadConfigFile(userConfigPath);

    // Workspace config: <repo-root>/.ghp/config.json
    const repoRoot = getRepoRoot();
    const workspaceConfigPath = repoRoot ? join(repoRoot, '.ghp', 'config.json') : null;
    const workspaceConfig = workspaceConfigPath ? loadConfigFile(workspaceConfigPath) : null;

    // Merge configs: defaults < user < workspace
    const result: McpConfig = { ...DEFAULT_MCP_CONFIG };

    // Apply user config
    if (userConfig?.mcp) {
        const userMcp = userConfig.mcp as McpConfig;
        if (userMcp.tools) {
            result.tools = { ...result.tools, ...userMcp.tools };
        }
        if (userMcp.disabledTools) {
            result.disabledTools = userMcp.disabledTools;
        }
        if (userMcp.enabledTools) {
            result.enabledTools = userMcp.enabledTools;
        }
    }

    // Apply workspace config (takes precedence)
    if (workspaceConfig?.mcp) {
        const workspaceMcp = workspaceConfig.mcp as McpConfig;
        if (workspaceMcp.tools) {
            result.tools = { ...result.tools, ...workspaceMcp.tools };
        }
        if (workspaceMcp.disabledTools) {
            // Workspace disabled tools extend user disabled tools
            result.disabledTools = [
                ...(result.disabledTools || []),
                ...workspaceMcp.disabledTools,
            ];
        }
        if (workspaceMcp.enabledTools) {
            // Workspace enabled tools extend user enabled tools
            result.enabledTools = [
                ...(result.enabledTools || []),
                ...workspaceMcp.enabledTools,
            ];
        }
    }

    return result;
}

/**
 * Hooks configuration for onFailure behavior
 */
export interface HooksConfig {
    onFailure: OnFailureBehavior;
}

/**
 * Load hooks configuration from user and workspace config files.
 * Workspace config takes precedence over user config.
 */
export function loadHooksConfig(): HooksConfig {
    // User config: ~/.config/ghp-cli/config.json
    const userConfigPath = join(homedir(), '.config', 'ghp-cli', 'config.json');
    const userConfig = loadConfigFile(userConfigPath);

    // Workspace config: <repo-root>/.ghp/config.json
    const repoRoot = getRepoRoot();
    const workspaceConfigPath = repoRoot ? join(repoRoot, '.ghp', 'config.json') : null;
    const workspaceConfig = workspaceConfigPath ? loadConfigFile(workspaceConfigPath) : null;

    // Default
    const result: HooksConfig = { onFailure: 'fail-fast' };

    // Apply user config
    const userHooks = userConfig?.hooks as { onFailure?: string } | undefined;
    if (userHooks?.onFailure === 'fail-fast' || userHooks?.onFailure === 'continue') {
        result.onFailure = userHooks.onFailure;
    }

    // Apply workspace config (takes precedence)
    const workspaceHooks = workspaceConfig?.hooks as { onFailure?: string } | undefined;
    if (workspaceHooks?.onFailure === 'fail-fast' || workspaceHooks?.onFailure === 'continue') {
        result.onFailure = workspaceHooks.onFailure;
    }

    return result;
}

/**
 * Read a top-level config value from user/workspace config (workspace wins).
 */
export function getConfigValue<T = string>(key: string, defaultValue: T): T {
    const userConfigPath = join(homedir(), '.config', 'ghp-cli', 'config.json');
    const userConfig = loadConfigFile(userConfigPath);

    const repoRoot = getRepoRoot();
    const workspaceConfigPath = repoRoot ? join(repoRoot, '.ghp', 'config.json') : null;
    const workspaceConfig = workspaceConfigPath ? loadConfigFile(workspaceConfigPath) : null;

    const workspaceVal = workspaceConfig?.[key];
    if (workspaceVal !== undefined) return workspaceVal as T;

    const userVal = userConfig?.[key];
    if (userVal !== undefined) return userVal as T;

    return defaultValue;
}

/**
 * Get list of all tool names and categories
 */
export function getToolList(): Array<{
    name: string;
    category: ToolCategory;
    capability: ToolCapability;
}> {
    return TOOLS.map(tool => ({
        name: tool.meta.name,
        category: tool.meta.category,
        capability: tool.meta.capability,
    }));
}

/**
 * Filter the tool registry to a given capability class. Hosted deployments
 * (ghp-mcp-hosted) should pass 'pure-api' to exclude subprocess / filesystem
 * tools that cannot safely run on a shared server.
 */
export function getToolsByCapability(
    capability: ToolCapability
): ReadonlyArray<ToolModule> {
    return TOOLS.filter(tool => tool.meta.capability === capability);
}

/**
 * Tools whose handlers only call the GitHub API — safe for hosted servers.
 */
export const pureApiTools: ReadonlyArray<ToolModule> = TOOLS.filter(
    t => t.meta.capability === 'pure-api'
);

/**
 * Tools that spawn local processes (git/gh/ghp) or read user-local state.
 * Only usable when the MCP server is running on the end-user's machine.
 */
export const localOnlyTools: ReadonlyArray<ToolModule> = TOOLS.filter(
    t => t.meta.capability === 'local-only'
);

/**
 * Check if a tool is enabled based on config
 */
function isToolEnabled(tool: ToolModule, config: McpConfig): boolean {
    const toolsConfig = config.tools || DEFAULT_MCP_CONFIG.tools!;
    const disabledTools = new Set(config.disabledTools || []);
    const enabledTools = new Set(config.enabledTools || []);

    // Check if category is enabled
    const categoryEnabled = toolsConfig[tool.meta.category] !== false;
    if (!categoryEnabled) {
        return false;
    }

    // Check if specifically disabled
    if (disabledTools.has(tool.meta.name)) {
        return false;
    }

    // Check if tool is disabled by default and not explicitly enabled
    if (tool.meta.disabledByDefault && !enabledTools.has(tool.meta.name)) {
        return false;
    }

    return true;
}

/**
 * Register enabled tools with the MCP server.
 *
 * When `capability` is supplied, only tools matching that capability class
 * are considered — this is how ghp-mcp-hosted requests the 'pure-api'
 * subset. Defaults to all capabilities (stdio behavior unchanged).
 */
export function registerEnabledTools(
    server: McpServer,
    context: ServerContext,
    config?: McpConfig,
    capability?: ToolCapability
): void {
    const mcpConfig = config || loadMcpConfig();
    const pool = capability ? getToolsByCapability(capability) : TOOLS;

    for (const tool of pool) {
        if (isToolEnabled(tool, mcpConfig)) {
            tool.register(server, context);
        }
    }
}

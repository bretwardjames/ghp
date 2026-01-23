import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from './server.js';
import type { ToolCategory, McpConfig, McpToolsConfig } from './types.js';
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

// Re-export types
export type { ToolCategory, McpConfig, McpToolsConfig } from './types.js';

/**
 * Tool module with metadata and registration function
 */
interface ToolModule {
    meta: { name: string; category: ToolCategory };
    register: (server: McpServer, context: ServerContext) => void;
}

/**
 * All available tools collected from individual modules
 */
const TOOLS: ToolModule[] = [
    workTool,
    planTool,
    moveTool,
    doneTool,
    startTool,
    addIssueTool,
    updateIssueTool,
    assignTool,
    commentTool,
    setFieldTool,
    worktreeTool,
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
    }

    return result;
}

/**
 * Get list of all tool names and categories
 */
export function getToolList(): Array<{ name: string; category: ToolCategory }> {
    return TOOLS.map(tool => ({
        name: tool.meta.name,
        category: tool.meta.category,
    }));
}

/**
 * Check if a tool is enabled based on config
 */
function isToolEnabled(tool: ToolModule, config: McpConfig): boolean {
    const toolsConfig = config.tools || DEFAULT_MCP_CONFIG.tools!;
    const disabledTools = new Set(config.disabledTools || []);

    // Check if category is enabled
    const categoryEnabled = toolsConfig[tool.meta.category] !== false;
    if (!categoryEnabled) {
        return false;
    }

    // Check if specifically disabled
    if (disabledTools.has(tool.meta.name)) {
        return false;
    }

    return true;
}

/**
 * Register enabled tools with the MCP server
 */
export function registerEnabledTools(
    server: McpServer,
    context: ServerContext,
    config?: McpConfig
): void {
    const mcpConfig = config || loadMcpConfig();

    for (const tool of TOOLS) {
        if (isToolEnabled(tool, mcpConfig)) {
            tool.register(server, context);
        }
    }
}

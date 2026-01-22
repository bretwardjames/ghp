import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from './server.js';
import { registerWorkTool } from './tools/work.js';
import { registerPlanTool } from './tools/plan.js';
import { registerMoveTool } from './tools/move.js';
import { registerDoneTool } from './tools/done.js';
import { registerStartTool } from './tools/start.js';
import { registerAddIssueTool } from './tools/add-issue.js';
import { registerUpdateIssueTool } from './tools/update-issue.js';
import { registerAssignTool } from './tools/assign.js';
import { registerCommentTool } from './tools/comment.js';
import { registerSetFieldTool } from './tools/set-field.js';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

/**
 * Tool categories for grouping and enabling/disabling tools
 */
export type ToolCategory = 'read' | 'action';

/**
 * Definition of a tool with metadata for registration and display
 */
export interface ToolDefinition {
    /** Internal tool name (used in MCP registration) */
    name: string;
    /** Human-readable display name */
    displayName: string;
    /** Tool category */
    category: ToolCategory;
    /** Brief description of what the tool does */
    description: string;
    /** Function to register the tool with the MCP server */
    register: (server: McpServer, context: ServerContext) => void;
}

/**
 * Configuration for MCP tool categories
 */
export interface McpToolsConfig {
    /** Enable read-only tools (get_my_work, get_project_board) */
    read?: boolean;
    /** Enable action tools (move, done, start, add-issue, etc.) */
    action?: boolean;
}

/**
 * Full MCP configuration section
 */
export interface McpConfig {
    /** Category-level tool toggles */
    tools?: McpToolsConfig;
    /** Array of specific tool names to disable */
    disabledTools?: string[];
}

/**
 * All available tools with their metadata
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
    // Read tools - for fetching information
    {
        name: 'get_my_work',
        displayName: 'Get My Work',
        category: 'read',
        description: 'Get GitHub Project issues assigned to you',
        register: registerWorkTool,
    },
    {
        name: 'get_project_board',
        displayName: 'Get Project Board',
        category: 'read',
        description: 'View a GitHub Project board with items grouped by status',
        register: registerPlanTool,
    },
    // Action tools - for modifying state
    {
        name: 'move_issue',
        displayName: 'Move Issue',
        category: 'action',
        description: 'Move an issue to a different status column',
        register: registerMoveTool,
    },
    {
        name: 'done_issue',
        displayName: 'Mark Done',
        category: 'action',
        description: 'Mark an issue as done',
        register: registerDoneTool,
    },
    {
        name: 'start_work',
        displayName: 'Start Work',
        category: 'action',
        description: 'Start working on an issue (sets status to In Progress)',
        register: registerStartTool,
    },
    {
        name: 'add_issue',
        displayName: 'Add Issue',
        category: 'action',
        description: 'Create a new issue and add it to a project',
        register: registerAddIssueTool,
    },
    {
        name: 'update_issue',
        displayName: 'Update Issue',
        category: 'action',
        description: 'Update an existing issue title or body',
        register: registerUpdateIssueTool,
    },
    {
        name: 'assign_issue',
        displayName: 'Assign Issue',
        category: 'action',
        description: 'Assign or unassign users to an issue',
        register: registerAssignTool,
    },
    {
        name: 'comment_issue',
        displayName: 'Comment on Issue',
        category: 'action',
        description: 'Add a comment to an issue',
        register: registerCommentTool,
    },
    {
        name: 'set_field',
        displayName: 'Set Field',
        category: 'action',
        description: 'Set a custom field value on a project item',
        register: registerSetFieldTool,
    },
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
 * Get all tool definitions
 */
export function getToolDefinitions(): ToolDefinition[] {
    return TOOL_DEFINITIONS;
}

/**
 * Get tools filtered by enabled status based on config
 */
export function getEnabledTools(config?: McpConfig): ToolDefinition[] {
    const mcpConfig = config || loadMcpConfig();
    const toolsConfig = mcpConfig.tools || DEFAULT_MCP_CONFIG.tools!;
    const disabledTools = new Set(mcpConfig.disabledTools || []);

    return TOOL_DEFINITIONS.filter((tool) => {
        // Check if category is enabled
        const categoryEnabled = toolsConfig[tool.category] !== false;
        if (!categoryEnabled) {
            return false;
        }

        // Check if specifically disabled
        if (disabledTools.has(tool.name)) {
            return false;
        }

        return true;
    });
}

/**
 * Get tool status for display (used by CLI --status command)
 */
export function getToolStatus(config?: McpConfig): Array<{
    name: string;
    displayName: string;
    category: ToolCategory;
    enabled: boolean;
    disabledReason?: 'category' | 'explicit';
}> {
    const mcpConfig = config || loadMcpConfig();
    const toolsConfig = mcpConfig.tools || DEFAULT_MCP_CONFIG.tools!;
    const disabledTools = new Set(mcpConfig.disabledTools || []);

    return TOOL_DEFINITIONS.map((tool) => {
        const categoryEnabled = toolsConfig[tool.category] !== false;
        const explicitlyDisabled = disabledTools.has(tool.name);

        let enabled = true;
        let disabledReason: 'category' | 'explicit' | undefined;

        if (!categoryEnabled) {
            enabled = false;
            disabledReason = 'category';
        } else if (explicitlyDisabled) {
            enabled = false;
            disabledReason = 'explicit';
        }

        return {
            name: tool.name,
            displayName: tool.displayName,
            category: tool.category,
            enabled,
            disabledReason,
        };
    });
}

/**
 * Register enabled tools with the MCP server
 */
export function registerEnabledTools(
    server: McpServer,
    context: ServerContext,
    config?: McpConfig
): void {
    const enabledTools = getEnabledTools(config);
    for (const tool of enabledTools) {
        tool.register(server, context);
    }
}

/**
 * Tool categories for grouping and enabling/disabling tools
 */
export type ToolCategory = 'read' | 'action';

/**
 * Capability classification: does the tool touch the host filesystem / shell,
 * or is it purely a GitHub API client? Hosted deployments (e.g. ghp-mcp-hosted)
 * must only register `pure-api` tools; `local-only` tools spawn git / gh / ghp
 * subprocesses or read from the user's home directory and cannot be safely
 * executed on a shared server.
 */
export type ToolCapability = 'pure-api' | 'local-only';

/**
 * Metadata about a tool for registry purposes
 */
export interface ToolMeta {
    /** Internal tool name (used in MCP registration) */
    name: string;
    /** Tool category for filtering */
    category: ToolCategory;
    /** Host capability requirements — see ToolCapability */
    capability: ToolCapability;
    /** If true, tool is disabled unless explicitly enabled via enabledTools config */
    disabledByDefault?: boolean;
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
    /** Array of specific tool names to enable (for opt-in tools with disabledByDefault) */
    enabledTools?: string[];
}

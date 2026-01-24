/**
 * Tool categories for grouping and enabling/disabling tools
 */
export type ToolCategory = 'read' | 'action' | 'memory';

/**
 * Metadata about a tool for registry purposes
 */
export interface ToolMeta {
    /** Internal tool name (used in MCP registration) */
    name: string;
    /** Tool category for filtering */
    category: ToolCategory;
}

/**
 * Configuration for MCP tool categories
 */
export interface McpToolsConfig {
    /** Enable read-only tools (get_my_work, get_project_board) */
    read?: boolean;
    /** Enable action tools (move, done, start, add-issue, etc.) */
    action?: boolean;
    /** Enable memory tools (memory_save, memory_search, etc.) */
    memory?: boolean;
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

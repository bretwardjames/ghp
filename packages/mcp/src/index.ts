/**
 * Library exports for @bretwardjames/ghp-mcp.
 *
 * Consumers (including the sibling @bretwardjames/ghp-mcp-hosted package)
 * can import the reusable runtime surface from here without triggering the
 * stdio bin. The bin lives at `./bin.js` and is only invoked when the
 * `ghp-mcp` command is run.
 */

export { createServer } from './server.js';
export type { ServerContext } from './server.js';

export {
    registerEnabledTools,
    loadMcpConfig,
    loadHooksConfig,
    getConfigValue,
    getToolList,
    getToolsByCapability,
    pureApiTools,
    localOnlyTools,
} from './tool-registry.js';
export type { HooksConfig } from './tool-registry.js';

export type {
    ToolCategory,
    ToolCapability,
    ToolMeta,
    McpConfig,
    McpToolsConfig,
} from './types.js';

export { registerAllResources } from './resources/index.js';

/**
 * Library exports for @bretwardjames/ghp-mcp-hosted.
 *
 * The default entry (the `ghp-mcp-hosted` binary) lives at `./bin.js`.
 * This module re-exports the pieces consumers might want to embed in a
 * larger Node process (for example, running the MCP endpoint as a route
 * inside an existing Express app).
 */

export { createApp } from './http-server.js';
export { loadConfig, parseRepoInfo } from './config.js';
export type { HostedConfig } from './config.js';
export {
    BearerTokenProvider,
    extractBearer,
} from './auth/bearer-token-provider.js';
export { assertHostedSafe, assertHostedMode } from './mode-guard.js';

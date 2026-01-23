/**
 * Claude AI integration for GitHub Projects utilities
 *
 * This module provides AI-powered features for:
 * - PR description generation
 * - Epic planning and issue breakdown
 * - Issue expansion from brief descriptions
 *
 * @example
 * ```typescript
 * import { ClaudeClient } from '@bretwardjames/ghp-core';
 *
 * const claude = new ClaudeClient({
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 * });
 *
 * // Generate a PR description
 * const description = await claude.generatePRDescription({
 *   diff: gitDiff,
 *   issue: { number: 123, title: 'Add feature', body: '...' },
 * });
 *
 * // Plan an epic with tool use
 * const result = await claude.planEpic({
 *   title: 'User Authentication',
 *   tools: {
 *     create_issue: async (input) => api.createIssue(repo, input),
 *   },
 *   callbacks: {
 *     onToken: (token) => process.stdout.write(token),
 *     onToolCall: (name, input) => console.log(`Calling ${name}...`),
 *   },
 * });
 * ```
 */

// =============================================================================
// Client
// =============================================================================

export { ClaudeClient } from './client.js';

// =============================================================================
// Types
// =============================================================================

export type {
    // Configuration
    ApiKeyProvider,
    ClaudeClientOptions,
    ResolvedClaudeConfig,

    // Streaming
    StreamCallbacks,

    // Tools
    ClaudeTool,
    ToolContext,
    ToolHandler,
    ToolHandlers,

    // Messages
    Message,
    ContentBlock,
    TokenUsage,
    ClaudeResult,

    // High-level API options
    GeneratePRDescriptionOptions,
    PlanEpicOptions,
    PlanEpicResult,
    ExpandIssueOptions,
    ExpandedIssue,
} from './types.js';

// =============================================================================
// Tools
// =============================================================================

export {
    GHP_TOOLS,
    getTools,
    TOOL_NAMES,
    CREATE_ISSUE_TOOL,
    SET_PARENT_TOOL,
    SET_FIELD_TOOL,
    ADD_BLOCKER_TOOL,
    ADD_TO_PROJECT_TOOL,
    ADD_LABELS_TOOL,
} from './tools.js';

// =============================================================================
// Prompts (for advanced customization)
// =============================================================================

export * as prompts from './prompts/index.js';

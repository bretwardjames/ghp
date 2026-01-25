/**
 * Types for Claude API integration
 */

import type Anthropic from '@anthropic-ai/sdk';

// =============================================================================
// Configuration & Authentication
// =============================================================================

/**
 * Provider for API keys - allows different sources (env, config, secret storage)
 */
export interface ApiKeyProvider {
    getApiKey(): Promise<string | null>;
}

/**
 * Options for ClaudeClient constructor
 */
export interface ClaudeClientOptions {
    /** Direct API key (not recommended for production) */
    apiKey?: string;
    /** Provider for API key (preferred - allows async retrieval from secret storage) */
    apiKeyProvider?: ApiKeyProvider;
    /** Model to use (default: claude-sonnet-4-20250514) */
    model?: string;
    /** Max tokens for responses (default: 4096) */
    maxTokens?: number;
}

/**
 * Resolved client configuration after initialization
 */
export interface ResolvedClaudeConfig {
    model: string;
    maxTokens: number;
}

// =============================================================================
// Streaming & Callbacks
// =============================================================================

/**
 * Callbacks for streaming responses
 */
export interface StreamCallbacks {
    /** Called for each text token received */
    onToken?: (token: string) => void;
    /** Called when a tool use is detected */
    onToolCall?: (toolName: string, toolInput: Record<string, unknown>) => void;
    /** Called when a tool result is available */
    onToolResult?: (toolName: string, result: unknown) => void;
    /** Called when thinking/reasoning is available (for extended thinking models) */
    onThinking?: (thinking: string) => void;
}

// =============================================================================
// Tool Use
// =============================================================================

/**
 * A tool that Claude can call
 */
export interface ClaudeTool {
    name: string;
    description: string;
    input_schema: {
        type: 'object';
        properties: Record<string, {
            type: string;
            description?: string;
            enum?: string[];
            items?: { type: string };
        }>;
        required?: string[];
    };
}

/**
 * Tool execution context passed to tool handlers
 */
export interface ToolContext {
    /** The GitHub API instance (if available) */
    githubApi?: unknown;
    /** Repository information */
    repo?: { owner: string; name: string };
    /** Current user */
    username?: string;
}

/**
 * Handler function for a tool
 */
export type ToolHandler<T = unknown> = (
    input: Record<string, unknown>,
    context: ToolContext
) => Promise<T>;

/**
 * Registry of tool handlers
 */
export interface ToolHandlers {
    [toolName: string]: ToolHandler;
}

// =============================================================================
// Request & Response Types
// =============================================================================

/**
 * A message in the conversation
 */
export interface Message {
    role: 'user' | 'assistant';
    content: string | ContentBlock[];
}

/**
 * Content block types
 */
export type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    | { type: 'tool_result'; tool_use_id: string; content: string };

/**
 * Usage statistics from a completion
 */
export interface TokenUsage {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
}

/**
 * Result from a Claude completion
 */
export interface ClaudeResult {
    /** The text response (if any) */
    text: string;
    /** Tool calls made during the response */
    toolCalls: Array<{
        name: string;
        input: Record<string, unknown>;
        result?: unknown;
    }>;
    /** Token usage for this request */
    usage: TokenUsage;
    /** Stop reason */
    stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}

// =============================================================================
// Streaming Types (Async Iterator API)
// =============================================================================

/**
 * Base type for all stream events
 */
export interface StreamEventBase {
    type: string;
}

/**
 * Text token received during streaming
 */
export interface StreamTextEvent extends StreamEventBase {
    type: 'text';
    text: string;
}

/**
 * Tool use started
 */
export interface StreamToolUseStartEvent extends StreamEventBase {
    type: 'tool_use_start';
    toolUseId: string;
    name: string;
}

/**
 * Tool input delta (partial JSON input)
 */
export interface StreamToolInputDeltaEvent extends StreamEventBase {
    type: 'tool_input_delta';
    toolUseId: string;
    partialJson: string;
}

/**
 * Tool use completed (full input available)
 */
export interface StreamToolUseCompleteEvent extends StreamEventBase {
    type: 'tool_use_complete';
    toolUseId: string;
    name: string;
    input: Record<string, unknown>;
}

/**
 * Message streaming completed
 */
export interface StreamMessageCompleteEvent extends StreamEventBase {
    type: 'message_complete';
    text: string;
    toolCalls: Array<{
        id: string;
        name: string;
        input: Record<string, unknown>;
    }>;
    usage: TokenUsage;
    stopReason: ClaudeResult['stopReason'];
}

/**
 * Error during streaming
 */
export interface StreamErrorEvent extends StreamEventBase {
    type: 'error';
    error: Error;
}

/**
 * Union of all stream event types
 */
export type StreamEvent =
    | StreamTextEvent
    | StreamToolUseStartEvent
    | StreamToolInputDeltaEvent
    | StreamToolUseCompleteEvent
    | StreamMessageCompleteEvent
    | StreamErrorEvent;

/**
 * Options for the stream() method
 */
export interface StreamOptions {
    /** System prompt */
    system?: string;
    /** Messages in the conversation */
    messages: Message[];
    /** Tools available to Claude */
    tools?: ClaudeTool[];
    /** Maximum tokens to generate */
    maxTokens?: number;
}

// =============================================================================
// High-Level API Types
// =============================================================================

/**
 * Options for PR description generation
 */
export interface GeneratePRDescriptionOptions {
    /** Git diff of the changes */
    diff: string;
    /** Linked issue details (optional) */
    issue?: {
        number: number;
        title: string;
        body: string;
    };
    /** Recent commit messages */
    commits?: string[];
    /** Additional context */
    context?: string;
    /** Project conventions (e.g., from CLAUDE.md) */
    conventions?: string;
    /** User feedback for regeneration */
    feedback?: string;
}

/**
 * Options for epic planning
 */
export interface PlanEpicOptions {
    /** Epic title/description */
    title: string;
    /** Project board context */
    context?: string;
    /** Existing issues in the project */
    existingIssues?: Array<{ number: number; title: string }>;
    /** Tool handlers for creating issues, etc. */
    tools?: ToolHandlers;
    /** Streaming callbacks */
    callbacks?: StreamCallbacks;
}

/**
 * Result from epic planning
 */
export interface PlanEpicResult extends ClaudeResult {
    /** Issues created during planning */
    createdIssues: Array<{
        number: number;
        title: string;
        parentNumber?: number;
    }>;
}

/**
 * Options for issue expansion
 */
export interface ExpandIssueOptions {
    /** Brief issue description */
    brief: string;
    /** Project context */
    projectContext?: string;
    /** Repository context */
    repoContext?: string;
}

/**
 * Expanded issue content
 */
export interface ExpandedIssue {
    title: string;
    body: string;
    suggestedLabels?: string[];
    suggestedAssignees?: string[];
}

/**
 * Claude API client for AI-assisted utilities.
 *
 * This class wraps the Anthropic SDK and provides high-level methods
 * for common tasks like PR description generation and epic planning.
 *
 * @example CLI usage:
 * ```typescript
 * const claude = new ClaudeClient({
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 * });
 *
 * const description = await claude.generatePRDescription({
 *   diff: gitDiff,
 *   issue: issueDetails,
 * });
 * ```
 *
 * @example VSCode usage:
 * ```typescript
 * const claude = new ClaudeClient({
 *   apiKeyProvider: {
 *     async getApiKey() {
 *       return await secretStorage.get('anthropic-api-key');
 *     }
 *   }
 * });
 * ```
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
    ClaudeClientOptions,
    ResolvedClaudeConfig,
    StreamCallbacks,
    ClaudeTool,
    ToolHandlers,
    ToolContext,
    Message,
    ContentBlock,
    TokenUsage,
    ClaudeResult,
    GeneratePRDescriptionOptions,
    PlanEpicOptions,
    PlanEpicResult,
    ExpandIssueOptions,
    ExpandedIssue,
    StreamOptions,
    StreamEvent,
} from './types.js';
import { buildPRDescriptionSystemPrompt } from './prompts/pr-description.js';
import { PLAN_EPIC_SYSTEM_PROMPT, buildPlanEpicUserPrompt } from './prompts/plan-epic.js';
import { EXPAND_ISSUE_PROMPT } from './prompts/expand-issue.js';
import { GHP_TOOLS } from './tools.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 4096;

export class ClaudeClient {
    private client: Anthropic | null = null;
    private options: ClaudeClientOptions;
    private config: ResolvedClaudeConfig;

    constructor(options: ClaudeClientOptions) {
        this.options = options;
        this.config = {
            model: options.model || DEFAULT_MODEL,
            maxTokens: options.maxTokens || DEFAULT_MAX_TOKENS,
        };
    }

    /**
     * Initialize the client with an API key
     */
    private async ensureClient(): Promise<Anthropic> {
        if (this.client) {
            return this.client;
        }

        let apiKey = this.options.apiKey;

        if (!apiKey && this.options.apiKeyProvider) {
            apiKey = await this.options.apiKeyProvider.getApiKey() ?? undefined;
        }

        if (!apiKey) {
            throw new Error(
                'No API key provided. Set ANTHROPIC_API_KEY environment variable, ' +
                'pass apiKey option, or provide an apiKeyProvider.'
            );
        }

        this.client = new Anthropic({ apiKey });
        return this.client;
    }

    /**
     * Get the current model configuration
     */
    get model(): string {
        return this.config.model;
    }

    /**
     * Get the current max tokens configuration
     */
    get maxTokens(): number {
        return this.config.maxTokens;
    }

    // =========================================================================
    // Low-Level API
    // =========================================================================

    /**
     * Send a message to Claude and get a response.
     * This is the low-level API for custom prompts.
     */
    async complete(options: {
        system?: string;
        messages: Message[];
        tools?: ClaudeTool[];
        toolHandlers?: ToolHandlers;
        toolContext?: ToolContext;
        maxTokens?: number;
        callbacks?: StreamCallbacks;
    }): Promise<ClaudeResult> {
        const client = await this.ensureClient();
        const maxTokens = options.maxTokens || this.config.maxTokens;

        // Convert our message format to Anthropic's format
        const messages = options.messages.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
        }));

        let text = '';
        const toolCalls: ClaudeResult['toolCalls'] = [];
        let usage: TokenUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
        let stopReason: ClaudeResult['stopReason'] = 'end_turn';

        // If streaming callbacks provided, use streaming
        if (options.callbacks?.onToken || options.callbacks?.onToolCall) {
            const stream = await client.messages.stream({
                model: this.config.model,
                max_tokens: maxTokens,
                system: options.system,
                messages,
                tools: options.tools as Anthropic.Tool[],
            });

            for await (const event of stream) {
                if (event.type === 'content_block_delta') {
                    const delta = event.delta;
                    if ('text' in delta && delta.text) {
                        text += delta.text;
                        options.callbacks?.onToken?.(delta.text);
                    }
                } else if (event.type === 'message_stop') {
                    // Message complete
                } else if (event.type === 'message_delta') {
                    if (event.usage) {
                        usage.output_tokens = event.usage.output_tokens;
                    }
                }
            }

            const finalMessage = await stream.finalMessage();
            usage.input_tokens = finalMessage.usage.input_tokens;
            usage.output_tokens = finalMessage.usage.output_tokens;
            usage.total_tokens = usage.input_tokens + usage.output_tokens;
            stopReason = finalMessage.stop_reason as ClaudeResult['stopReason'];

            // Process tool uses from final message
            for (const block of finalMessage.content) {
                if (block.type === 'tool_use') {
                    toolCalls.push({
                        name: block.name,
                        input: block.input as Record<string, unknown>,
                    });
                }
            }
        } else {
            // Non-streaming request
            const response = await client.messages.create({
                model: this.config.model,
                max_tokens: maxTokens,
                system: options.system,
                messages,
                tools: options.tools as Anthropic.Tool[],
            });

            usage = {
                input_tokens: response.usage.input_tokens,
                output_tokens: response.usage.output_tokens,
                total_tokens: response.usage.input_tokens + response.usage.output_tokens,
            };
            stopReason = response.stop_reason as ClaudeResult['stopReason'];

            for (const block of response.content) {
                if (block.type === 'text') {
                    text += block.text;
                } else if (block.type === 'tool_use') {
                    toolCalls.push({
                        name: block.name,
                        input: block.input as Record<string, unknown>,
                    });
                }
            }
        }

        // Execute tool calls if handlers provided
        if (toolCalls.length > 0 && options.toolHandlers) {
            for (const toolCall of toolCalls) {
                const handler = options.toolHandlers[toolCall.name];
                if (handler) {
                    options.callbacks?.onToolCall?.(toolCall.name, toolCall.input);
                    try {
                        const result = await handler(toolCall.input, options.toolContext || {});
                        toolCall.result = result;
                        options.callbacks?.onToolResult?.(toolCall.name, result);
                    } catch (error) {
                        toolCall.result = { error: error instanceof Error ? error.message : 'Unknown error' };
                        options.callbacks?.onToolResult?.(toolCall.name, toolCall.result);
                    }
                }
            }
        }

        return { text, toolCalls, usage, stopReason };
    }

    /**
     * Stream a response from Claude using an async iterator.
     * This provides fine-grained control over streaming events.
     *
     * @example Basic streaming:
     * ```typescript
     * for await (const event of claude.stream({
     *   messages: [{ role: 'user', content: 'Hello!' }],
     * })) {
     *   if (event.type === 'text') {
     *     process.stdout.write(event.text);
     *   } else if (event.type === 'message_complete') {
     *     console.log('\nUsage:', event.usage);
     *   }
     * }
     * ```
     *
     * @example With tool use:
     * ```typescript
     * for await (const event of claude.stream({
     *   messages: [{ role: 'user', content: 'What is 2+2?' }],
     *   tools: [calculatorTool],
     * })) {
     *   if (event.type === 'tool_use_complete') {
     *     console.log(`Tool ${event.name} called with:`, event.input);
     *   }
     * }
     * ```
     */
    async *stream(options: StreamOptions): AsyncGenerator<StreamEvent, void, unknown> {
        const client = await this.ensureClient();
        const maxTokens = options.maxTokens || this.config.maxTokens;

        // Convert our message format to Anthropic's format
        const messages = options.messages.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
        }));

        try {
            const stream = await client.messages.stream({
                model: this.config.model,
                max_tokens: maxTokens,
                system: options.system,
                messages,
                tools: options.tools as Anthropic.Tool[],
            });

            let text = '';
            const toolCalls: Array<{
                id: string;
                name: string;
                input: Record<string, unknown>;
                partialJson: string;
            }> = [];
            let currentToolIndex = -1;

            for await (const event of stream) {
                if (event.type === 'content_block_start') {
                    const block = event.content_block;
                    if (block.type === 'tool_use') {
                        currentToolIndex = event.index;
                        toolCalls[currentToolIndex] = {
                            id: block.id,
                            name: block.name,
                            input: {},
                            partialJson: '',
                        };
                        yield {
                            type: 'tool_use_start',
                            toolUseId: block.id,
                            name: block.name,
                        };
                    }
                } else if (event.type === 'content_block_delta') {
                    const delta = event.delta;
                    if ('text' in delta && delta.text) {
                        text += delta.text;
                        yield {
                            type: 'text',
                            text: delta.text,
                        };
                    } else if ('partial_json' in delta && delta.partial_json) {
                        // Tool input delta
                        const toolCall = toolCalls[event.index];
                        if (toolCall) {
                            toolCall.partialJson += delta.partial_json;
                            yield {
                                type: 'tool_input_delta',
                                toolUseId: toolCall.id,
                                partialJson: delta.partial_json,
                            };
                        }
                    }
                } else if (event.type === 'content_block_stop') {
                    // Check if this was a tool use block
                    const toolCall = toolCalls[event.index];
                    if (toolCall && toolCall.partialJson) {
                        try {
                            toolCall.input = JSON.parse(toolCall.partialJson);
                        } catch {
                            toolCall.input = {};
                        }
                        yield {
                            type: 'tool_use_complete',
                            toolUseId: toolCall.id,
                            name: toolCall.name,
                            input: toolCall.input,
                        };
                    }
                }
            }

            // Get final message for usage and stop reason
            const finalMessage = await stream.finalMessage();
            const usage: TokenUsage = {
                input_tokens: finalMessage.usage.input_tokens,
                output_tokens: finalMessage.usage.output_tokens,
                total_tokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
            };

            // Extract any tool uses that weren't captured in streaming
            const finalToolCalls = finalMessage.content
                .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
                .map(block => ({
                    id: block.id,
                    name: block.name,
                    input: block.input as Record<string, unknown>,
                }));

            yield {
                type: 'message_complete',
                text,
                toolCalls: finalToolCalls,
                usage,
                stopReason: finalMessage.stop_reason as ClaudeResult['stopReason'],
            };
        } catch (error) {
            yield {
                type: 'error',
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }
    }

    /**
     * Run a multi-turn conversation with tool use until completion.
     * Handles the tool use loop automatically.
     */
    async runWithTools(options: {
        system?: string;
        initialMessage: string;
        tools: ClaudeTool[];
        toolHandlers: ToolHandlers;
        toolContext?: ToolContext;
        maxTokens?: number;
        maxTurns?: number;
        callbacks?: StreamCallbacks;
    }): Promise<ClaudeResult> {
        const maxTurns = options.maxTurns || 10;
        const messages: Message[] = [
            { role: 'user', content: options.initialMessage },
        ];

        let totalUsage: TokenUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
        const allToolCalls: ClaudeResult['toolCalls'] = [];
        let finalText = '';
        let turn = 0;

        while (turn < maxTurns) {
            turn++;

            const result = await this.complete({
                system: options.system,
                messages,
                tools: options.tools,
                toolHandlers: options.toolHandlers,
                toolContext: options.toolContext,
                maxTokens: options.maxTokens,
                callbacks: options.callbacks,
            });

            // Accumulate usage
            totalUsage.input_tokens += result.usage.input_tokens;
            totalUsage.output_tokens += result.usage.output_tokens;
            totalUsage.total_tokens += result.usage.total_tokens;

            // If no tool calls, we're done
            if (result.toolCalls.length === 0 || result.stopReason !== 'tool_use') {
                finalText = result.text;
                break;
            }

            // Build assistant message with tool uses
            const assistantContent: ContentBlock[] = [];
            if (result.text) {
                assistantContent.push({ type: 'text', text: result.text });
            }
            for (const tc of result.toolCalls) {
                assistantContent.push({
                    type: 'tool_use',
                    id: `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                    name: tc.name,
                    input: tc.input,
                });
                allToolCalls.push(tc);
            }
            messages.push({ role: 'assistant', content: assistantContent });

            // Build tool results message
            const toolResults: ContentBlock[] = result.toolCalls.map((tc, i) => ({
                type: 'tool_result' as const,
                tool_use_id: (assistantContent[assistantContent.length - result.toolCalls.length + i] as { id: string }).id,
                content: JSON.stringify(tc.result ?? { success: true }),
            }));
            messages.push({ role: 'user', content: toolResults });
        }

        return {
            text: finalText,
            toolCalls: allToolCalls,
            usage: totalUsage,
            stopReason: 'end_turn',
        };
    }

    // =========================================================================
    // High-Level API
    // =========================================================================

    /**
     * Generate a PR description from a diff and optional issue context.
     */
    async generatePRDescription(options: GeneratePRDescriptionOptions): Promise<string> {
        const userMessage = this.buildPRDescriptionPrompt(options);
        const systemPrompt = buildPRDescriptionSystemPrompt(options.conventions);

        const result = await this.complete({
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }],
        });

        return result.text;
    }

    private buildPRDescriptionPrompt(options: GeneratePRDescriptionOptions): string {
        let prompt = '## Git Diff\n```diff\n' + options.diff + '\n```\n\n';

        if (options.issue) {
            prompt += '## Linked Issue\n';
            prompt += `**#${options.issue.number}: ${options.issue.title}**\n\n`;
            prompt += options.issue.body + '\n\n';
        }

        if (options.feedback) {
            prompt += '## User Feedback\n';
            prompt += 'Please regenerate the PR description taking this feedback into account:\n';
            prompt += options.feedback + '\n\n';
        }

        if (options.commits && options.commits.length > 0) {
            prompt += '## Recent Commits\n';
            for (const commit of options.commits) {
                prompt += `- ${commit}\n`;
            }
            prompt += '\n';
        }

        if (options.context) {
            prompt += '## Additional Context\n' + options.context + '\n';
        }

        return prompt;
    }

    /**
     * Plan an epic by breaking it down into issues.
     * Can use tools to actually create the issues.
     */
    async planEpic(options: PlanEpicOptions): Promise<PlanEpicResult> {
        const userMessage = buildPlanEpicUserPrompt(options);
        const createdIssues: PlanEpicResult['createdIssues'] = [];

        // Wrap tool handlers to track created issues
        const wrappedHandlers: ToolHandlers = {};
        if (options.tools) {
            for (const [name, handler] of Object.entries(options.tools)) {
                wrappedHandlers[name] = async (input, context) => {
                    const result = await handler(input, context);
                    if (name === 'create_issue' && result && typeof result === 'object') {
                        const issueResult = result as { number?: number; title?: string };
                        if (issueResult.number) {
                            createdIssues.push({
                                number: issueResult.number,
                                title: issueResult.title || input.title as string,
                            });
                        }
                    }
                    return result;
                };
            }
        }

        const result = await this.runWithTools({
            system: PLAN_EPIC_SYSTEM_PROMPT,
            initialMessage: userMessage,
            tools: GHP_TOOLS,
            toolHandlers: wrappedHandlers,
            toolContext: options.tools ? {} : undefined,
            callbacks: options.callbacks,
        });

        return {
            ...result,
            createdIssues,
        };
    }

    /**
     * Expand a brief issue description into a full issue with acceptance criteria.
     */
    async expandIssue(options: ExpandIssueOptions): Promise<ExpandedIssue> {
        let prompt = `Brief: ${options.brief}\n\n`;

        if (options.projectContext) {
            prompt += `Project Context:\n${options.projectContext}\n\n`;
        }

        if (options.repoContext) {
            prompt += `Repository Context:\n${options.repoContext}\n\n`;
        }

        const result = await this.complete({
            system: EXPAND_ISSUE_PROMPT,
            messages: [{ role: 'user', content: prompt }],
        });

        // Parse the response - expect JSON format
        try {
            const parsed = JSON.parse(result.text);
            return {
                title: parsed.title || options.brief,
                body: parsed.body || result.text,
                suggestedLabels: parsed.labels,
                suggestedAssignees: parsed.assignees,
            };
        } catch {
            // If not JSON, use the text as the body
            return {
                title: options.brief,
                body: result.text,
            };
        }
    }
}

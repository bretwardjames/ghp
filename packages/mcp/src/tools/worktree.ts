import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { execSync } from 'child_process';
import type { ServerContext } from '../server.js';

/**
 * Subagent spawn directive returned by the CLI.
 */
interface SubagentSpawnDirective {
    action: 'spawn_subagent';
    workingDirectory: string;
    issue: {
        number: number;
        title: string;
        status: string | null;
        url: string;
    };
    branch: string;
    repository: {
        owner: string;
        name: string;
        mainBranch: string;
    };
    memory: {
        namespace: string;
    };
    handoffPrompt: string;
}

/**
 * Parse the spawn directive from CLI output.
 */
function parseSpawnDirective(output: string): SubagentSpawnDirective | null {
    const match = output.match(/\[GHP_SPAWN_DIRECTIVE\]([\s\S]*?)\[\/GHP_SPAWN_DIRECTIVE\]/);
    if (!match) {
        return null;
    }
    try {
        return JSON.parse(match[1].trim());
    } catch {
        return null;
    }
}

/**
 * Registers the create_worktree tool.
 * Creates a git worktree for parallel work on an issue, with optional subagent spawning context.
 */
export function registerWorktreeTool(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'create_worktree',
        {
            title: 'Create Worktree',
            description:
                'Create a git worktree for working on an issue in parallel. Returns subagent spawn context for AI assistant orchestration.',
            inputSchema: {
                issue: z.number().describe('Issue number to create worktree for'),
                worktreePath: z
                    .string()
                    .optional()
                    .describe('Custom path for the worktree (optional)'),
                spawnSubagent: z
                    .boolean()
                    .optional()
                    .describe(
                        'Return subagent spawn directive for AI assistant orchestration (default: true)'
                    ),
            },
        },
        async ({ issue, worktreePath, spawnSubagent = true }) => {
            const authenticated = await context.ensureAuthenticated();
            if (!authenticated) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: 'Error: Not authenticated.',
                        },
                    ],
                    isError: true,
                };
            }

            const repo = await context.getRepo();
            if (!repo) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: 'Error: Not in a git repository with a GitHub remote.',
                        },
                    ],
                    isError: true,
                };
            }

            try {
                // Build the CLI command
                let cmd = `ghp start ${issue} --parallel -fd --force`;
                if (worktreePath) {
                    cmd += ` --worktree-path "${worktreePath}"`;
                }
                if (spawnSubagent) {
                    cmd += ' --spawn-subagent';
                }

                // Execute the CLI command
                const output = execSync(cmd, {
                    encoding: 'utf-8',
                    cwd: process.cwd(),
                    env: process.env,
                });

                // Parse the spawn directive if present
                const directive = spawnSubagent ? parseSpawnDirective(output) : null;

                // Build the response
                const response: {
                    content: Array<{ type: 'text'; text: string }>;
                    _subagentSpawn?: SubagentSpawnDirective;
                } = {
                    content: [
                        {
                            type: 'text' as const,
                            text: directive
                                ? `Created worktree for issue #${issue} at ${directive.workingDirectory}\n\nBranch: ${directive.branch}\nNamespace: ${directive.memory.namespace}`
                                : `Created worktree for issue #${issue}.\n\n${output}`,
                        },
                    ],
                };

                // Include the spawn directive metadata for AI assistant orchestration
                if (directive) {
                    response._subagentSpawn = directive;
                }

                return response;
            } catch (error) {
                const errorMessage =
                    error instanceof Error ? error.message : String(error);
                // Try to extract useful info from CLI error output
                const stderr =
                    (error as { stderr?: Buffer | string })?.stderr?.toString() || '';
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Error creating worktree: ${errorMessage}${stderr ? `\n\n${stderr}` : ''}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

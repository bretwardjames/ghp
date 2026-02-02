import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { validateNumericInput } from '@bretwardjames/ghp-core';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'get_progress',
    category: 'read',
    disabledByDefault: true,
};

/**
 * Registers the get_progress tool.
 * Shows progress of an epic/parent issue based on sub-issue states.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'get_progress',
        {
            title: 'Get Epic Progress',
            description:
                'Get progress summary for an epic/parent issue. Shows completion based on sub-issue states.',
            inputSchema: {
                issue: z.number().describe('Epic/parent issue number'),
            },
        },
        async ({ issue }) => {
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
                const safeIssue = validateNumericInput(issue, 'issue');

                // Get issue relationships
                const relationships = await context.api.getIssueRelationships(repo, safeIssue);
                if (!relationships) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `Issue #${issue} not found.`,
                            },
                        ],
                        isError: true,
                    };
                }

                const subIssues = relationships.subIssues;

                if (subIssues.length === 0) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `Issue #${issue} "${relationships.title}" has no sub-issues.`,
                            },
                        ],
                    };
                }

                // Count states
                const total = subIssues.length;
                const closed = subIssues.filter(s => s.state === 'CLOSED').length;
                const open = total - closed;
                const percentage = Math.round((closed / total) * 100);

                // Build progress bar
                const barLength = 20;
                const filledLength = Math.round((closed / total) * barLength);
                const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

                // Build sub-issue list
                const subIssueList = subIssues
                    .map(s => {
                        const icon = s.state === 'CLOSED' ? '✓' : '○';
                        return `  ${icon} #${s.number}: ${s.title}`;
                    })
                    .join('\n');

                const message = [
                    `Progress for #${issue} "${relationships.title}"`,
                    '',
                    `[${bar}] ${percentage}%`,
                    `${closed}/${total} completed (${open} remaining)`,
                    '',
                    'Sub-issues:',
                    subIssueList,
                ].join('\n');

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: message,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Error getting progress: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

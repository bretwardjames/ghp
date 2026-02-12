import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';
import { parseSince, formatStandupText } from '@bretwardjames/ghp-core';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'get_standup',
    category: 'read',
};

/**
 * Registers the get_standup tool.
 * Returns recent issue activity for standup summaries.
 * Defaults to current user's activity (like --mine).
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'get_standup',
        {
            title: 'Get Standup Summary',
            description:
                'Get recent issue activity for standup summaries. Defaults to the current user\'s activity in the last 24h. Use user="all" for all activity.',
            inputSchema: {
                since: z
                    .string()
                    .optional()
                    .describe('Time window: "24h" (default), "8h", "2d", "1w", or an ISO date'),
                user: z
                    .string()
                    .optional()
                    .describe('Filter to a specific user, or "all" for everyone. Defaults to current user.'),
                timeline: z
                    .boolean()
                    .optional()
                    .describe('If true, show a flat chronological timeline instead of grouping by issue'),
                format: z
                    .enum(['json', 'text'])
                    .optional()
                    .describe('Output format: "json" (default) for structured data, "text" for human-readable summary'),
            },
        },
        async ({ since = '24h', user, timeline, format = 'json' }) => {
            const authenticated = await context.ensureAuthenticated();
            if (!authenticated) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Error: Not authenticated. Please ensure gh CLI is authenticated or set GITHUB_TOKEN.',
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
                            type: 'text',
                            text: 'Error: Not in a git repository with a GitHub remote.',
                        },
                    ],
                    isError: true,
                };
            }

            try {
                let sinceDate: Date;
                try {
                    sinceDate = parseSince(since);
                } catch (err) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Error: ${(err as Error).message}`,
                            },
                        ],
                        isError: true,
                    };
                }

                // Default to current user's activity; --user all = everyone
                const userLower = user?.toLowerCase();
                const activityOptions = userLower === 'all'
                    ? {}
                    : { user: user || undefined, mine: !user };

                const activities = await context.api.getRecentActivity(repo, sinceDate, activityOptions);

                if (format === 'text') {
                    const text = formatStandupText(activities, { since: sinceDate, timeline });
                    return {
                        content: [{ type: 'text', text }],
                    };
                }

                // JSON format (default for MCP)
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                since: sinceDate.toISOString(),
                                issueCount: activities.length,
                                activities,
                            }, null, 2),
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error fetching standup data: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

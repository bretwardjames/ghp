import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';

/**
 * Registers the get_project_board tool.
 * Returns the project board view grouped by status.
 */
export function registerPlanTool(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'get_project_board',
        {
            title: 'Get Project Board',
            description:
                'View a GitHub Project board with items grouped by status. Shows issues and PRs organized in a kanban-style view.',
            inputSchema: {
                project: z
                    .string()
                    .optional()
                    .describe('Project name to view (uses first project if not specified)'),
                status: z
                    .array(z.string())
                    .optional()
                    .describe('Filter to specific statuses'),
                mine: z
                    .boolean()
                    .optional()
                    .describe('Show only items assigned to you'),
            },
        },
        async ({ project, status, mine = false }) => {
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
                const projects = await context.api.getProjects(repo);
                if (projects.length === 0) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'No GitHub Projects found for this repository.',
                            },
                        ],
                    };
                }

                // Find the target project
                let targetProject = projects[0];
                if (project) {
                    const found = projects.find(
                        (p) => p.title.toLowerCase() === project.toLowerCase()
                    );
                    if (!found) {
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `Project "${project}" not found. Available projects: ${projects.map((p) => p.title).join(', ')}`,
                                },
                            ],
                        };
                    }
                    targetProject = found;
                }

                // Get all items
                const items = await context.api.getProjectItems(
                    targetProject.id,
                    targetProject.title
                );

                // Apply filters
                let filteredItems = items;

                if (mine && context.api.username) {
                    filteredItems = filteredItems.filter((item) =>
                        item.assignees.includes(context.api.username!)
                    );
                }

                if (status && status.length > 0) {
                    const statusLower = status.map((s) => s.toLowerCase());
                    filteredItems = filteredItems.filter(
                        (item) =>
                            item.status &&
                            statusLower.includes(item.status.toLowerCase())
                    );
                }

                // Group by status
                const grouped: Record<string, typeof filteredItems> = {};
                for (const item of filteredItems) {
                    const statusKey = item.status || 'No Status';
                    if (!grouped[statusKey]) {
                        grouped[statusKey] = [];
                    }
                    grouped[statusKey].push(item);
                }

                // Sort groups by status index
                const sortedGroups = Object.entries(grouped).sort(([, a], [, b]) => {
                    const aIndex = a[0]?.statusIndex ?? 999;
                    const bIndex = b[0]?.statusIndex ?? 999;
                    return aIndex - bIndex;
                });

                // Format response
                const board = {
                    project: targetProject.title,
                    url: targetProject.url,
                    columns: sortedGroups.map(([statusName, items]) => ({
                        status: statusName,
                        count: items.length,
                        items: items.map((item) => ({
                            number: item.number,
                            title: item.title,
                            type: item.type,
                            assignees: item.assignees,
                            labels: item.labels.map((l) => l.name),
                            url: item.url,
                        })),
                    })),
                };

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(board, null, 2),
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error fetching project board: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

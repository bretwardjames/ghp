import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'get_my_work',
    category: 'read',
};

/**
 * Registers the get_my_work tool.
 * Returns issues assigned to the authenticated user.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'get_my_work',
        {
            title: 'Get My Work',
            description:
                'Get GitHub Project issues assigned to you. Returns a list of issues from all projects linked to the current repository.',
            inputSchema: {
                status: z
                    .array(z.string())
                    .optional()
                    .describe('Filter by status (e.g., ["In Progress", "Todo"])'),
                hideDone: z
                    .boolean()
                    .optional()
                    .describe('Hide completed items (default: true)'),
                all: z
                    .boolean()
                    .optional()
                    .describe('Show all items, not just assigned to you'),
                project: z
                    .string()
                    .optional()
                    .describe('Filter to a specific project by name'),
            },
        },
        async ({ status, hideDone = true, all = false, project }) => {
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

                // Filter projects by name if specified
                const filteredProjects = project
                    ? projects.filter(
                          (p) => p.title.toLowerCase() === project.toLowerCase()
                      )
                    : projects;

                if (filteredProjects.length === 0) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `No project found with name "${project}".`,
                            },
                        ],
                    };
                }

                // Gather items from all projects
                const allItems = [];
                for (const proj of filteredProjects) {
                    const items = await context.api.getProjectItems(
                        proj.id,
                        proj.title
                    );
                    allItems.push(...items);
                }

                // Apply filters
                let filteredItems = allItems;

                // Filter by assignee (unless all=true)
                if (!all && context.api.username) {
                    filteredItems = filteredItems.filter((item) =>
                        item.assignees.includes(context.api.username!)
                    );
                }

                // Filter by status
                if (status && status.length > 0) {
                    const statusLower = status.map((s) => s.toLowerCase());
                    filteredItems = filteredItems.filter(
                        (item) =>
                            item.status &&
                            statusLower.includes(item.status.toLowerCase())
                    );
                }

                // Hide done items
                if (hideDone) {
                    filteredItems = filteredItems.filter(
                        (item) =>
                            item.status?.toLowerCase() !== 'done' &&
                            item.state !== 'closed'
                    );
                }

                // Format response
                const result = filteredItems.map((item) => ({
                    number: item.number,
                    title: item.title,
                    type: item.type,
                    status: item.status,
                    state: item.state,
                    assignees: item.assignees,
                    labels: item.labels.map((l) => l.name),
                    project: item.projectTitle,
                    url: item.url,
                }));

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error fetching work items: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

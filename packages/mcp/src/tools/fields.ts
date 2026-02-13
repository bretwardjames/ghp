import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'get_fields',
    category: 'read',
};

/**
 * Registers the get_fields tool.
 * Returns project fields and their valid values (options for single-select, type for others).
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'get_fields',
        {
            title: 'Get Project Fields',
            description:
                'Get all project fields and their valid values. Useful for discovering what values can be used with set_field, move_issue, or add_issue --field flags.',
            inputSchema: {
                project: z
                    .string()
                    .optional()
                    .describe('Project name to query (defaults to first project)'),
            },
        },
        async ({ project: projectName }) => {
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
                                text: 'No projects found for this repository.',
                            },
                        ],
                        isError: true,
                    };
                }

                // Select project by name if provided, otherwise first
                let selectedProject = projects[0];
                if (projectName) {
                    const match = projects.find(
                        p => p.title.toLowerCase() === projectName.toLowerCase()
                    );
                    if (!match) {
                        const available = projects.map(p => p.title).join(', ');
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `Project "${projectName}" not found. Available projects: ${available}`,
                                },
                            ],
                            isError: true,
                        };
                    }
                    selectedProject = match;
                }

                const fields = await context.api.getProjectFields(selectedProject.id);

                const result = {
                    project: selectedProject.title,
                    fields: fields.map(f => ({
                        name: f.name,
                        type: f.type || 'Text',
                        options: f.options?.map(o => o.name),
                    })),
                };

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
                            text: `Error fetching project fields: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

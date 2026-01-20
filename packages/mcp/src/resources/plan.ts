import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../server.js';

/**
 * Registers the ghp://plan resource.
 * Returns the project board grouped by status.
 */
export function registerPlanResource(server: McpServer, context: ServerContext): void {
    server.registerResource(
        'plan',
        'ghp://plan',
        {
            title: 'Project Board',
            description: 'Project board view with items grouped by status',
            mimeType: 'application/json',
        },
        async (uri) => {
            const authenticated = await context.ensureAuthenticated();
            if (!authenticated) {
                return {
                    contents: [
                        {
                            uri: uri.href,
                            mimeType: 'application/json',
                            text: JSON.stringify({ error: 'Not authenticated' }),
                        },
                    ],
                };
            }

            const repo = await context.getRepo();
            if (!repo) {
                return {
                    contents: [
                        {
                            uri: uri.href,
                            mimeType: 'application/json',
                            text: JSON.stringify({ error: 'Not in a git repository' }),
                        },
                    ],
                };
            }

            try {
                const projects = await context.api.getProjects(repo);
                if (projects.length === 0) {
                    return {
                        contents: [
                            {
                                uri: uri.href,
                                mimeType: 'application/json',
                                text: JSON.stringify({ projects: [], message: 'No projects found' }),
                            },
                        ],
                    };
                }

                // Use the first project
                const project = projects[0];
                const items = await context.api.getProjectItems(project.id, project.title);

                // Group by status
                const grouped: Record<string, typeof items> = {};
                for (const item of items) {
                    const statusKey = item.status || 'No Status';
                    if (!grouped[statusKey]) {
                        grouped[statusKey] = [];
                    }
                    grouped[statusKey].push(item);
                }

                // Sort by status index
                const sortedGroups = Object.entries(grouped).sort(([, a], [, b]) => {
                    const aIndex = a[0]?.statusIndex ?? 999;
                    const bIndex = b[0]?.statusIndex ?? 999;
                    return aIndex - bIndex;
                });

                const board = {
                    project: project.title,
                    url: project.url,
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
                    contents: [
                        {
                            uri: uri.href,
                            mimeType: 'application/json',
                            text: JSON.stringify(board, null, 2),
                        },
                    ],
                };
            } catch (error) {
                return {
                    contents: [
                        {
                            uri: uri.href,
                            mimeType: 'application/json',
                            text: JSON.stringify({
                                error: error instanceof Error ? error.message : String(error),
                            }),
                        },
                    ],
                };
            }
        }
    );
}

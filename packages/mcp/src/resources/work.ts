import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../server.js';

/**
 * Registers the ghp://work resource.
 * Returns issues assigned to the authenticated user.
 */
export function registerWorkResource(server: McpServer, context: ServerContext): void {
    server.registerResource(
        'work',
        'ghp://work',
        {
            title: 'My Work',
            description: 'Issues assigned to you across all projects in this repository',
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
                const allItems = [];

                for (const project of projects) {
                    const items = await context.api.getProjectItems(project.id, project.title);
                    allItems.push(...items);
                }

                // Filter to assigned items, hide done
                const myItems = allItems.filter(
                    (item) =>
                        context.api.username &&
                        item.assignees.includes(context.api.username) &&
                        item.status?.toLowerCase() !== 'done' &&
                        item.state !== 'closed'
                );

                const result = myItems.map((item) => ({
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
                    contents: [
                        {
                            uri: uri.href,
                            mimeType: 'application/json',
                            text: JSON.stringify(result, null, 2),
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

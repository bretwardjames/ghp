import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../server.js';

/**
 * Registers the ghp://projects resource.
 * Returns available GitHub Projects for the current repository.
 */
export function registerProjectsResource(server: McpServer, context: ServerContext): void {
    server.registerResource(
        'projects',
        'ghp://projects',
        {
            title: 'Available Projects',
            description: 'List of GitHub Projects linked to this repository',
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

                const result = {
                    repository: repo.fullName,
                    projects: projects.map((p) => ({
                        id: p.id,
                        title: p.title,
                        number: p.number,
                        url: p.url,
                    })),
                };

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

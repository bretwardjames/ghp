import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';

/**
 * Registers the create_issue tool.
 * Creates a new GitHub issue.
 */
export function registerAddIssueTool(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'create_issue',
        {
            title: 'Create Issue',
            description:
                'Create a new GitHub issue in the current repository. Optionally add it to a project with a specific status.',
            inputSchema: {
                title: z.string().describe('Issue title'),
                body: z.string().optional().describe('Issue body/description'),
                project: z
                    .string()
                    .optional()
                    .describe('Project name to add the issue to'),
                status: z
                    .string()
                    .optional()
                    .describe('Initial status in the project (e.g., "Todo")'),
            },
        },
        async ({ title, body, project, status }) => {
            const authenticated = await context.ensureAuthenticated();
            if (!authenticated) {
                return {
                    content: [
                        {
                            type: 'text',
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
                            type: 'text',
                            text: 'Error: Not in a git repository with a GitHub remote.',
                        },
                    ],
                    isError: true,
                };
            }

            try {
                // Create the issue
                const result = await context.api.createIssue(repo, title, body);
                const issueUrl = `https://github.com/${repo.owner}/${repo.name}/issues/${result.number}`;

                let message = `Created issue #${result.number}: "${title}"\n${issueUrl}`;

                // If project specified, add to project
                if (project) {
                    const projects = await context.api.getProjects(repo);
                    const targetProject = projects.find(
                        (p) => p.title.toLowerCase() === project.toLowerCase()
                    );

                    if (!targetProject) {
                        message += `\n\nWarning: Project "${project}" not found. Issue was created but not added to a project.`;
                    } else {
                        // Note: Adding to project would require additional API methods
                        // For now, just note that manual addition is needed
                        message += `\n\nNote: Please manually add the issue to project "${targetProject.title}" if needed.`;
                    }
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: message,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error creating issue: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

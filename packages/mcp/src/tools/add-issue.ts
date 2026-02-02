import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';
import { loadHooksConfig } from '../tool-registry.js';
import {
    executeHooksForEvent,
    hasHooksForEvent,
    type IssueCreatedPayload,
} from '@bretwardjames/ghp-core';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'create_issue',
    category: 'action',
};

/**
 * Registers the create_issue tool.
 * Creates a new GitHub issue.
 */
export function register(server: McpServer, context: ServerContext): void {
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

                // Add to project (always - find project by name or use first)
                const projects = await context.api.getProjects(repo);
                if (projects.length === 0) {
                    message += '\n\nWarning: No GitHub Projects found. Issue was created but not added to a project.';
                } else {
                    let targetProject = projects[0];
                    if (project) {
                        const found = projects.find(
                            (p) => p.title.toLowerCase() === project.toLowerCase()
                        );
                        if (!found) {
                            message += `\n\nWarning: Project "${project}" not found. Added to "${targetProject.title}" instead.`;
                        } else {
                            targetProject = found;
                        }
                    }

                    // Add issue to project
                    const itemId = await context.api.addToProject(targetProject.id, result.id);
                    if (!itemId) {
                        message += `\n\nWarning: Failed to add issue to project "${targetProject.title}".`;
                    } else {
                        message += `\nAdded to project: ${targetProject.title}`;

                        // Set initial status if specified
                        if (status) {
                            const statusField = await context.api.getStatusField(targetProject.id);
                            if (statusField) {
                                const option = statusField.options.find(
                                    (o) => o.name.toLowerCase() === status.toLowerCase()
                                );
                                if (option) {
                                    await context.api.updateItemStatus(
                                        targetProject.id,
                                        itemId,
                                        statusField.fieldId,
                                        option.id
                                    );
                                    message += `\nStatus: ${option.name}`;
                                } else {
                                    const validStatuses = statusField.options.map((o) => o.name).join(', ');
                                    message += `\n\nWarning: Status "${status}" not found. Valid options: ${validStatuses}`;
                                }
                            }
                        }
                    }
                }

                // Fire issue-created hook
                if (hasHooksForEvent('issue-created')) {
                    const payload: IssueCreatedPayload = {
                        repo: `${repo.owner}/${repo.name}`,
                        issue: {
                            number: result.number,
                            title,
                            body: body || '',
                            url: issueUrl,
                        },
                    };

                    const hooksConfig = loadHooksConfig();
                    const hookResults = await executeHooksForEvent('issue-created', payload, {
                        onFailure: hooksConfig.onFailure,
                    });
                    const successCount = hookResults.filter(r => r.success).length;
                    const failCount = hookResults.length - successCount;

                    if (hookResults.length > 0) {
                        message += `\n\nHooks: ${successCount} succeeded`;
                        if (failCount > 0) {
                            message += `, ${failCount} failed`;
                        }
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

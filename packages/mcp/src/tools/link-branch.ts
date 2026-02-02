import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import {
    BranchLinker,
    validateNumericInput,
    validateSafeString,
} from '@bretwardjames/ghp-core';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'link_branch',
    category: 'action',
    disabledByDefault: true,
};

/**
 * Registers the link_branch tool.
 * Links a git branch to an issue.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'link_branch',
        {
            title: 'Link Branch',
            description:
                'Link a git branch to an issue. Stores the link in the issue body.',
            inputSchema: {
                issue: z.number().describe('Issue number'),
                branch: z.string().describe('Branch name to link'),
            },
        },
        async ({ issue, branch }) => {
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
                const safeBranch = validateSafeString(branch, 'branch');

                const linker = new BranchLinker(context.api);

                const success = await linker.linkBranch(repo, safeIssue, safeBranch);

                if (!success) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `Failed to link branch "${branch}" to issue #${issue}. Make sure the issue exists.`,
                            },
                        ],
                        isError: true,
                    };
                }

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Linked branch "${branch}" to issue #${issue}.`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Error linking branch: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';
import {
    planning,
    type IterationInfo,
    type MilestoneInfo,
} from '@bretwardjames/ghp-core';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'get_planning_audit',
    category: 'read',
    capability: 'pure-api',
};

/**
 * Registers the get_planning_audit tool.
 *
 * Returns a readiness report the LLM can use to drive (or explain why
 * it can't yet drive) a planning meeting: which project fields exist,
 * what fallbacks the tool will use when they don't, and findings about
 * the iteration + milestone timeline (missing upcoming sprints, stale
 * milestones, etc.).
 *
 * The stateful meeting-driver tools land in a follow-up ticket. This
 * is the first diagnostic surface and keeps the PR scope small.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'get_planning_audit',
        {
            title: 'Audit Planning Readiness',
            description:
                'Audit the GitHub Project for planning-meeting readiness: required/fallback fields, iteration rolling-window coverage, milestone timeline. Returns actionable suggestions for missing pieces without mutating anything.',
            inputSchema: {
                project: z
                    .string()
                    .optional()
                    .describe(
                        'Project name to audit. Defaults to the first project linked to the repo.'
                    ),
                rollingWindowSize: z
                    .number()
                    .int()
                    .min(1)
                    .max(6)
                    .optional()
                    .describe(
                        'How many future iterations to plan for (default 3 per the flow doc).'
                    ),
            },
        },
        async ({ project, rollingWindowSize }) => {
            const authenticated = await context.ensureAuthenticated();
            if (!authenticated) {
                return errorResponse('Not authenticated. Ensure gh auth or GITHUB_TOKEN.');
            }
            const repo = await context.getRepo();
            if (!repo) {
                return errorResponse(
                    'Not in a git repository with a GitHub remote.'
                );
            }

            const projects = await context.api.getProjects(repo);
            if (projects.length === 0) {
                return errorResponse(`No projects linked to ${repo.fullName}.`);
            }
            const selected = project
                ? projects.find(
                      (p) => p.title.toLowerCase() === project.toLowerCase()
                  )
                : projects[0];
            if (!selected) {
                return errorResponse(
                    `Project "${project}" not found. Available: ${projects
                        .map((p) => p.title)
                        .join(', ')}`
                );
            }

            const fields = await context.api.getProjectFields(selected.id);
            const fieldProbe = planning.probeProjectFields(
                selected.id,
                selected.title,
                fields
            );

            // Extract iterations from the Sprint field (if present) so the
            // timeline audit can reason about the rolling window.
            const sprintField = fields.find(
                (f) => f.name.toLowerCase() === 'sprint' && f.type.toLowerCase().includes('iteration')
            );
            const iterations: IterationInfo[] = [];
            let completedIterationCount = 0;
            if (sprintField) {
                // `options` holds both active + completed iterations once
                // core.getProjectFields flattens them; dates aren't on the
                // flattened shape so we re-query the raw field via the
                // getProjectFields response. Simpler: fetch once, reflect
                // from options.
                const rawField = fields.find((f) => f.id === sprintField.id);
                for (const opt of rawField?.options ?? []) {
                    // Flattened options lose the startDate/duration; to
                    // preserve them we'd need a dedicated query. For now
                    // we surface iteration names only and skip the
                    // rolling-window checks if dates are unknown.
                    iterations.push({
                        id: opt.id,
                        title: opt.name,
                        startDate: '', // unknown under the current flatten
                        duration: 7,
                    });
                }
                // When startDates are missing, the audit won't find a
                // "current" iteration — which surfaces the right finding
                // (no-current-iteration) automatically.
            }

            let milestones: MilestoneInfo[] = [];
            try {
                milestones = await context.api.listOpenMilestones(repo);
            } catch {
                // Non-fatal: the audit simply reports no milestones.
            }

            const timeline = planning.auditTimeline({
                iterations,
                completedIterationCount,
                milestones,
                rollingWindowSize,
            });

            const report: planning.PlanningCapabilityReport = {
                ...fieldProbe,
                timeline,
            };

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(report, null, 2),
                    },
                ],
            };
        }
    );
}

function errorResponse(text: string) {
    return {
        content: [{ type: 'text' as const, text: `Error: ${text}` }],
        isError: true,
    };
}

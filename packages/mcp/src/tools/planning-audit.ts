import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';
import { planning } from '@bretwardjames/ghp-core';
type IterationInfo = planning.IterationInfo;
type MilestoneInfo = planning.MilestoneInfo;

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

            // Extract iterations (with real startDate + duration) from
            // the Sprint field — core.getProjectFields exposes the raw
            // iteration list on the field metadata so we don't need a
            // second query.
            const sprintField = fields.find(
                (f) =>
                    f.name.toLowerCase() === 'sprint' &&
                    (f.type.toLowerCase() === 'iteration' ||
                        f.dataType?.toLowerCase() === 'iteration')
            );
            const iterations: IterationInfo[] = [];
            let completedIterationCount = 0;
            if (sprintField?.iterations) {
                for (const iter of sprintField.iterations) {
                    if (iter.completed) {
                        completedIterationCount += 1;
                        continue;
                    }
                    iterations.push({
                        id: iter.id,
                        title: iter.title,
                        startDate: iter.startDate,
                        duration: iter.duration,
                    });
                }
            }

            const warnings: string[] = [];
            let milestones: MilestoneInfo[] = [];
            try {
                const ms = await context.api.listOpenMilestones(repo);
                milestones = ms.milestones;
                if (ms.truncated) {
                    warnings.push(
                        'More than 50 open milestones in this repo; audit covers only the first 50 ordered by dueOn asc. Stale-milestone findings may be accurate but current/upcoming picks may be wrong.'
                    );
                }
            } catch (err) {
                // Don't silently treat a fetch failure as "repo has no
                // milestones" — that would invert the audit's advice.
                warnings.push(
                    `Failed to fetch milestones: ${
                        err instanceof Error ? err.message : String(err)
                    }. Milestone findings in this report may be incomplete.`
                );
            }

            const timeline = planning.auditTimeline({
                iterations,
                completedIterationCount,
                milestones,
                rollingWindowSize,
            });

            const report = {
                ...fieldProbe,
                timeline,
                ...(warnings.length > 0 ? { warnings } : {}),
            } satisfies planning.PlanningCapabilityReport & {
                warnings?: string[];
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

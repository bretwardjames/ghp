import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';
import { planning } from '@bretwardjames/ghp-core';
import {
    getPlanningStore,
    hydrateActiveItemBody,
    newSessionId,
    ownerKeyForProcess,
} from './planning-session.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'planning_start',
    category: 'action',
    capability: 'pure-api',
};

/**
 * Open an interactive planning-meeting session. Probes the project,
 * builds a ranked queue of items to discuss, and returns the first
 * item. The LLM then drives the meeting via planning_next /
 * planning_decide / planning_park / planning_status / planning_end.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'planning_start',
        {
            title: 'Start Planning Meeting',
            description:
                'Open a planning-meeting session: capability-probe the project, build a ranked queue of items that need discussion, and return the first item. Freshness filter excludes items reviewed in the last N days so the same ticket does not resurface week over week. Subsequent calls to planning_next / planning_decide / planning_park advance through the queue.',
            inputSchema: {
                meetingType: z
                    .enum(['weekly', 'milestone-boundary'])
                    .default('weekly')
                    .describe(
                        'Weekly: steps 4-7 of the flow doc (sprint assign, triage, forward plan, release check). milestone-boundary: adds milestone wrap-up + full backlog review.'
                    ),
                minDaysSinceLastReview: z
                    .number()
                    .int()
                    .min(0)
                    .max(180)
                    .default(7)
                    .describe(
                        'Skip items reviewed within this many days. Default 7 matches the weekly meeting cadence.'
                    ),
                maxMinutesPerTicket: z
                    .number()
                    .int()
                    .min(1)
                    .max(60)
                    .default(3)
                    .describe(
                        'Soft cap on wall-clock per item. planning_status flags items past this limit so the LLM can suggest parking them.'
                    ),
                project: z
                    .string()
                    .optional()
                    .describe(
                        'Project name. Defaults to the first project linked to the repo.'
                    ),
            },
        },
        async ({ meetingType, minDaysSinceLastReview, maxMinutesPerTicket, project }) => {
            const authenticated = await context.ensureAuthenticated();
            if (!authenticated) return errorResponse('Not authenticated.');
            const repo = await context.getRepo();
            if (!repo) return errorResponse('Not in a GitHub repo.');

            const projects = await context.api.getProjects(repo);
            if (projects.length === 0) {
                return errorResponse(`No projects linked to ${repo.fullName}.`);
            }
            const selected = project
                ? projects.find((p) => p.title.toLowerCase() === project.toLowerCase())
                : projects[0];
            if (!selected) {
                return errorResponse(
                    `Project "${project}" not found. Available: ${projects.map((p) => p.title).join(', ')}`
                );
            }

            // Probe + timeline (reuses the same logic as get_planning_audit).
            const fields = await context.api.getProjectFields(selected.id);
            const fieldProbe = planning.probeProjectFields(
                selected.id,
                selected.title,
                fields
            );
            const sprintField = fields.find(
                (f) =>
                    f.name.toLowerCase() === 'sprint' &&
                    (f.type.toLowerCase() === 'iteration' ||
                        f.dataType?.toLowerCase() === 'iteration')
            );
            const liveIterations: planning.IterationInfo[] = [];
            let completedIterationCount = 0;
            for (const iter of sprintField?.iterations ?? []) {
                if (iter.completed) {
                    completedIterationCount += 1;
                    continue;
                }
                liveIterations.push({
                    id: iter.id,
                    title: iter.title,
                    startDate: iter.startDate,
                    duration: iter.duration,
                });
            }

            let milestones: planning.MilestoneInfo[] = [];
            const warnings: string[] = [];
            try {
                const ms = await context.api.listOpenMilestones(repo);
                milestones = ms.milestones;
                if (ms.truncated) warnings.push('Milestone list truncated at 50.');
            } catch (err) {
                warnings.push(
                    `listOpenMilestones failed: ${err instanceof Error ? err.message : err}`
                );
            }

            const timeline = planning.auditTimeline({
                iterations: liveIterations,
                completedIterationCount,
                milestones,
            });

            const capability: planning.PlanningCapabilityReport = {
                ...fieldProbe,
                timeline,
            };

            // Fetch items and turn them into QueueInputItems.
            const items = await context.api.getProjectItems(selected.id, selected.title);
            const currentSprintTitle = timeline.iterations.current?.title ?? null;
            const upcomingSprintTitles = timeline.iterations.upcoming.map(
                (i) => i.title
            );
            const queue = planning.buildQueue({
                items: items
                    .filter((it) => it.number != null)
                    .map((it) => ({
                        number: it.number!,
                        title: it.title,
                        url: it.url,
                        status: it.status,
                        priority: it.fields['Priority'] ?? null,
                        size: it.fields['Size'] ?? null,
                        assignees: it.assignees,
                        lastReviewed: it.fields['Last Reviewed'] ?? null,
                        iterationTitle: it.fields['Sprint'] ?? null,
                        repository: it.repository,
                    })),
                meetingType,
                currentSprintTitle,
                upcomingSprintTitles,
                minDaysSinceLastReview,
            });

            const sessionId = newSessionId();
            const active = queue.length > 0 ? queue[0] : null;
            // Hydrate the first item's body before we return so the LLM
            // has context for the opening discussion, not just the title.
            // Uses the item's own repo (multi-repo projects have items
            // outside the session's default repo).
            await hydrateActiveItemBody(context, active);
            const session: planning.PlanningSession = {
                id: sessionId,
                startedAt: Date.now(),
                ownerKey: ownerKeyForProcess(),
                meetingType,
                maxMinutesPerTicket,
                minDaysSinceLastReview,
                capability,
                queue: active ? queue.slice(1) : queue,
                decisions: {},
                parked: [],
                activeItem: active,
                activeItemSince: active ? Date.now() : null,
            };

            getPlanningStore().start(session);

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(
                            {
                                sessionId,
                                meetingType,
                                projectTitle: selected.title,
                                capability,
                                warnings,
                                queueLength: session.queue.length,
                                active: session.activeItem,
                                totalItemsToReview:
                                    session.queue.length + (active ? 1 : 0),
                            },
                            null,
                            2
                        ),
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

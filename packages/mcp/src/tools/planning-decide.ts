import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';
import { planning } from '@bretwardjames/ghp-core';
import { getPlanningStore, hydrateActiveItemBody } from './planning-session.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'planning_decide',
    category: 'action',
    capability: 'pure-api',
};

/**
 * Record a verdict for the active item and advance to the next one.
 *
 * The tool writes "Last Reviewed" either to the project's Date field
 * (when present) or as a sentinel comment in the issue body (fallback).
 * This is what prevents the same item resurfacing next week.
 *
 * The tool DOES NOT change the issue's status — the LLM invokes
 * existing tools (move_issue, mark_done, add_comment, …) for the
 * actual mutation. `planning_decide` is strictly a "we discussed this
 * and decided X, move on" signal.
 */
export function register(server: McpServer, context: ServerContext): void {
    server.registerTool(
        'planning_decide',
        {
            title: 'Record Planning Decision',
            description:
                'Record a decision on the currently-active planning item: write Last Reviewed (via project field or sentinel comment), store the verdict, and advance to the next item. Does NOT change issue status — run move_issue / mark_done / etc. separately for that.',
            inputSchema: {
                sessionId: z.string().describe('Session id from planning_start'),
                issueNumber: z
                    .number()
                    .int()
                    .positive()
                    .describe('The issue number we are deciding on (must match active item).'),
                decision: z
                    .enum([
                        'kill-list',
                        'backlog',
                        'close',
                        'bump',
                        'assign',
                        'no-change',
                    ])
                    .describe('Verdict recorded in the review sentinel.'),
                notes: z
                    .string()
                    .max(500)
                    .optional()
                    .describe('Optional short note to include in the session summary.'),
            },
        },
        async ({ sessionId, issueNumber, decision, notes }) => {
            const store = getPlanningStore();
            const session = store.get(sessionId);
            if (!session) return errorResponse('Session not found or expired.');

            if (!session.activeItem || session.activeItem.number !== issueNumber) {
                return errorResponse(
                    `Active item is #${session.activeItem?.number ?? 'none'}, but decision targets #${issueNumber}. Call planning_next first.`
                );
            }

            const repo = await context.getRepo();
            if (!repo) return errorResponse('Not in a GitHub repo.');

            // Prefer the real Last Reviewed Date field when the probe
            // said it exists; fall back to the body sentinel otherwise.
            const hasRealField =
                session.capability.detected['Last Reviewed'] === true;

            let sentinelWritten = false;
            const today = planning.todayIsoDate();

            if (hasRealField) {
                // Write via the project field. Need the item's project
                // item ID + the Last Reviewed field ID.
                const fields = await context.api.getProjectFields(
                    session.capability.projectId
                );
                const lastReviewedField = fields.find(
                    (f) => f.name.toLowerCase() === 'last reviewed'
                );
                const items = await context.api.getProjectItems(
                    session.capability.projectId,
                    session.capability.projectTitle
                );
                const projectItem = items.find((it) => it.number === issueNumber);
                if (lastReviewedField && projectItem) {
                    const result = await context.api.setFieldValue(
                        session.capability.projectId,
                        projectItem.id,
                        lastReviewedField.id,
                        { date: today }
                    );
                    sentinelWritten = result.success;
                }
            } else {
                // Fallback path: upsert the sentinel into the issue body.
                const details = await context.api.getIssueDetails(
                    repo,
                    issueNumber
                );
                if (details) {
                    const actor = await resolveActor(context);
                    const newBody = planning.upsertSentinel(details.body, {
                        reviewedOn: today,
                        decision,
                        by: actor,
                    });
                    const ok = await context.api.updateIssueBody(
                        repo,
                        issueNumber,
                        newBody
                    );
                    sentinelWritten = ok;
                }
            }

            session.decisions[issueNumber] = {
                decision,
                notes: notes ?? '',
                decidedAt: Date.now(),
                sentinelWritten,
            };

            // Advance to next item.
            const nextItem = session.queue[0] ?? null;
            session.queue = session.queue.slice(1);
            session.activeItem = nextItem;
            session.activeItemSince = nextItem ? Date.now() : null;
            await hydrateActiveItemBody(context, repo, session.activeItem);
            store.update(session);

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(
                            {
                                recorded: {
                                    issueNumber,
                                    decision,
                                    sentinelWritten,
                                    sentinelMode: hasRealField ? 'field' : 'body-sentinel',
                                },
                                active: session.activeItem,
                                queueLength: session.queue.length,
                                decided: Object.keys(session.decisions).length,
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

async function resolveActor(context: ServerContext): Promise<string> {
    // `api.authenticate()` caches viewer login via ensureAuthenticated;
    // we look at the exposed getter if present. Fall back to 'reviewer'
    // so the sentinel regex still matches even when the login cannot
    // be resolved.
    const api = context.api as unknown as { viewerLogin?: string };
    return typeof api.viewerLogin === 'string' && api.viewerLogin.length > 0
        ? api.viewerLogin
        : 'reviewer';
}

function errorResponse(text: string) {
    return {
        content: [{ type: 'text' as const, text: `Error: ${text}` }],
        isError: true,
    };
}

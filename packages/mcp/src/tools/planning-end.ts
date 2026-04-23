import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';
import { getPlanningStore } from './planning-session.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'planning_end',
    category: 'action',
    capability: 'pure-api',
};

/**
 * Close the session. Returns a summary of decisions + parked items for
 * the LLM to render as the meeting recap. Does NOT auto-post a recap
 * comment — the caller can hand the summary back through add_comment
 * or a separate write if they want it captured in an issue.
 */
export function register(server: McpServer, _context: ServerContext): void {
    server.registerTool(
        'planning_end',
        {
            title: 'End Planning Meeting',
            description:
                'Close the active planning session and return a summary: decisions recorded, items parked, items left in the queue, elapsed time. The LLM can hand this summary to add_comment if the team wants it persisted to an issue.',
            inputSchema: {
                sessionId: z.string().describe('Session id from planning_start'),
            },
        },
        async ({ sessionId }) => {
            const store = getPlanningStore();
            const session = store.end(sessionId);
            if (!session) {
                return {
                    content: [
                        { type: 'text' as const, text: 'Error: session not found or already ended.' },
                    ],
                    isError: true,
                };
            }

            const elapsedMinutes = Math.round((Date.now() - session.startedAt) / 60_000);
            const decisions = Object.entries(session.decisions).map(([num, d]) => ({
                issueNumber: Number(num),
                decision: d.decision,
                notes: d.notes,
                sentinelWritten: d.sentinelWritten,
            }));

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(
                            {
                                meetingType: session.meetingType,
                                elapsedMinutes,
                                totalsReviewed: decisions.length,
                                decisions,
                                parked: session.parked,
                                remainingInQueue: session.queue.length,
                                remainingItems: session.queue.map((q) => ({
                                    number: q.number,
                                    title: q.title,
                                    bucket: q.bucket,
                                })),
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

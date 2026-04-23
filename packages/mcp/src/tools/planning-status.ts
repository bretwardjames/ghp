import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';
import { getPlanningStore } from './planning-session.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'planning_status',
    category: 'read',
    capability: 'pure-api',
};

/**
 * Snapshot of the active session: queue remaining, items already
 * decided, items parked, and a flag when the active item has been
 * in front of the team longer than the session's per-ticket cap.
 */
export function register(server: McpServer, _context: ServerContext): void {
    server.registerTool(
        'planning_status',
        {
            title: 'Planning Session Status',
            description:
                'Snapshot of the active planning session: active item, queue length, decisions so far, parked items, and a time-in-debate warning when the active item has been discussed longer than maxMinutesPerTicket. Useful for the LLM to nudge "we\'ve been on this a while — park or decide?"',
            inputSchema: {
                sessionId: z.string().describe('Session id from planning_start'),
            },
        },
        async ({ sessionId }) => {
            const store = getPlanningStore();
            const session = store.get(sessionId);
            if (!session) {
                return {
                    content: [
                        { type: 'text' as const, text: 'Error: session not found or expired.' },
                    ],
                    isError: true,
                };
            }

            const minutesOnActive =
                session.activeItemSince
                    ? (Date.now() - session.activeItemSince) / 60_000
                    : 0;
            const overTimebox =
                !!session.activeItem &&
                minutesOnActive > session.maxMinutesPerTicket;

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(
                            {
                                sessionId: session.id,
                                meetingType: session.meetingType,
                                active: session.activeItem,
                                minutesOnActive: Math.round(minutesOnActive * 10) / 10,
                                overTimebox,
                                maxMinutesPerTicket: session.maxMinutesPerTicket,
                                queueLength: session.queue.length,
                                decisions: Object.entries(session.decisions).map(
                                    ([num, d]) => ({
                                        issueNumber: Number(num),
                                        decision: d.decision,
                                        sentinelWritten: d.sentinelWritten,
                                    })
                                ),
                                parked: session.parked,
                                sessionElapsedMinutes: Math.round(
                                    (Date.now() - session.startedAt) / 60_000
                                ),
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

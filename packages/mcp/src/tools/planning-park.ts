import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';
import { getPlanningStore } from './planning-session.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'planning_park',
    category: 'action',
    capability: 'pure-api',
};

/**
 * Defer the active item: move it to the bottom of the queue without
 * writing a review sentinel. The team can come back to it later in
 * the same meeting if there's time. No Last Reviewed update means
 * parked items will resurface next week exactly as they would have.
 */
export function register(server: McpServer, _context: ServerContext): void {
    server.registerTool(
        'planning_park',
        {
            title: 'Park Planning Item',
            description:
                'Defer the active planning item to the end of this session\'s queue. Does NOT record a review (item will resurface next week normally). Use this when a discussion is getting long and the team wants to come back to it with more context.',
            inputSchema: {
                sessionId: z.string().describe('Session id from planning_start'),
                issueNumber: z
                    .number()
                    .int()
                    .positive()
                    .describe('Active item number. Guards against stale calls.'),
                reason: z
                    .string()
                    .max(280)
                    .optional()
                    .describe('Optional short note for the session summary.'),
            },
        },
        async ({ sessionId, issueNumber, reason }) => {
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
            if (!session.activeItem || session.activeItem.number !== issueNumber) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Error: active item is #${session.activeItem?.number ?? 'none'}, not #${issueNumber}.`,
                        },
                    ],
                    isError: true,
                };
            }

            // Move active to the bottom of the queue.
            const parkedItem = session.activeItem;
            session.queue.push(parkedItem);
            session.parked.push(parkedItem.number);

            const nextItem = session.queue.shift() ?? null;
            session.activeItem = nextItem;
            session.activeItemSince = nextItem ? Date.now() : null;
            store.update(session);

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(
                            {
                                parked: { number: parkedItem.number, reason: reason ?? null },
                                active: session.activeItem,
                                queueLength: session.queue.length,
                                totalParked: session.parked.length,
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

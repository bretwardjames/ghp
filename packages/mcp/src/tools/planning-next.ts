import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { ServerContext } from '../server.js';
import type { ToolMeta } from '../types.js';
import { getPlanningStore } from './planning-session.js';

/** Tool metadata for registry */
export const meta: ToolMeta = {
    name: 'planning_next',
    category: 'read',
    capability: 'pure-api',
};

/**
 * Advance to the next item in the queue without recording a decision.
 * Useful when the team wants to peek at what's coming or the active
 * item was handled outside the tool (e.g., someone already closed it
 * manually during the meeting).
 *
 * For the normal flow, callers should prefer `planning_decide` which
 * records the verdict and advances in one step.
 */
export function register(server: McpServer, _context: ServerContext): void {
    server.registerTool(
        'planning_next',
        {
            title: 'Next Planning Item',
            description:
                'Advance the planning queue to the next item without recording a decision. Returns { active, queueLength, remaining } or { active: null } when the queue is exhausted.',
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
                        {
                            type: 'text' as const,
                            text: 'Error: session not found or expired. Start a new one with planning_start.',
                        },
                    ],
                    isError: true,
                };
            }

            const nextItem = session.queue[0] ?? null;
            session.queue = session.queue.slice(1);
            session.activeItem = nextItem;
            session.activeItemSince = nextItem ? Date.now() : null;
            store.update(session);

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(
                            {
                                active: session.activeItem,
                                queueLength: session.queue.length,
                                decided: Object.keys(session.decisions).length,
                                parked: session.parked.length,
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

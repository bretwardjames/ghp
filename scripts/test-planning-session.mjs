#!/usr/bin/env node
/**
 * Smoke test: walk the full planning-session loop against a real repo
 * using core logic directly (no MCP transport).
 *
 *   node scripts/test-planning-session.mjs owner/name [project-title]
 */

import { execSync } from 'node:child_process';
import {
    GitHubAPI,
    planning,
} from '../packages/core/dist/index.js';

const [, , repoArg, projectArg] = process.argv;
if (!repoArg?.includes('/')) {
    console.error('Usage: node scripts/test-planning-session.mjs owner/name [project]');
    process.exit(1);
}
const [owner, name] = repoArg.split('/');
const repo = { owner, name, fullName: `${owner}/${name}` };

const token = process.env.GITHUB_TOKEN
    ?? process.env.GH_TOKEN
    ?? execSync('gh auth token', { encoding: 'utf-8' }).trim();
const api = new GitHubAPI({ tokenProvider: { getToken: async () => token } });
await api.authenticate();

const projects = await api.getProjects(repo);
const selected = projectArg
    ? projects.find((p) => p.title.toLowerCase() === projectArg.toLowerCase())
    : projects[0];
if (!selected) {
    console.error(`No project matching "${projectArg ?? '<default>'}"`);
    process.exit(1);
}
console.log(`project: ${selected.title}`);

const fields = await api.getProjectFields(selected.id);
const fieldProbe = planning.probeProjectFields(selected.id, selected.title, fields);

const sprintField = fields.find(
    (f) => f.name.toLowerCase() === 'sprint' && (f.type.toLowerCase() === 'iteration' || f.dataType?.toLowerCase() === 'iteration')
);
const iterations = [];
for (const iter of sprintField?.iterations ?? []) {
    if (!iter.completed) {
        iterations.push({ id: iter.id, title: iter.title, startDate: iter.startDate, duration: iter.duration });
    }
}
let milestones = [];
try { milestones = (await api.listOpenMilestones(repo)).milestones; } catch {}

const timeline = planning.auditTimeline({ iterations, completedIterationCount: 0, milestones });
const currentSprintTitle = timeline.iterations.current?.title ?? null;
const upcomingSprintTitles = timeline.iterations.upcoming.map((i) => i.title);

const items = await api.getProjectItems(selected.id, selected.title);
console.log(`  ${items.length} items in project`);

const queueInput = items
    .filter((it) => it.number != null)
    .map((it) => ({
        number: it.number,
        title: it.title,
        url: it.url,
        status: it.status,
        priority: it.fields['Priority'] ?? null,
        size: it.fields['Size'] ?? null,
        assignees: it.assignees,
        lastReviewed: it.fields['Last Reviewed'] ?? null,
        iterationTitle: it.fields['Sprint'] ?? null,
    }));

const queue = planning.buildQueue({
    items: queueInput,
    meetingType: 'weekly',
    currentSprintTitle,
    upcomingSprintTitles,
    minDaysSinceLastReview: 7,
});

console.log(`\n=== QUEUE (${queue.length} items, meeting-step order) ===\n`);
// Show queue summary + bucket breakdown
const byBucket = queue.reduce((acc, q) => {
    acc[q.bucket] = (acc[q.bucket] ?? 0) + 1;
    return acc;
}, {});
console.log('bucket counts:', byBucket);

console.log('\nfirst 10 items in meeting order:');
for (const it of queue.slice(0, 10)) {
    const age = it.lastReviewed ? `${planning.daysSince(it.lastReviewed)}d` : 'never';
    const pr = it.priority ?? '-';
    console.log(
        `  [${it.bucket.padEnd(30)}] #${String(it.number).padEnd(4)}  priority=${pr.padEnd(8)}  reviewed=${age.padEnd(6)}  ${it.title}`
    );
}

if (queue.length === 0) {
    console.log('\n(queue empty — no items to discuss under current freshness + status filter)');
    process.exit(0);
}

console.log('\n=== SESSION SIMULATION ===');
const store = new planning.PlanningSessionStore();
const sessionId = 'smoke-session';
const active = queue[0];
const session = {
    id: sessionId,
    startedAt: Date.now(),
    ownerKey: 'smoke',
    meetingType: 'weekly',
    maxMinutesPerTicket: 3,
    minDaysSinceLastReview: 7,
    capability: { ...fieldProbe, timeline },
    queue: queue.slice(1),
    decisions: {},
    parked: [],
    activeItem: active,
    activeItemSince: Date.now(),
};
store.start(session);

console.log(`start → active=#${active.number}  queueLength=${session.queue.length}`);

// Simulate 3 decisions + 1 park
const actions = [
    { kind: 'decide', decision: 'backlog', notes: 'no change — revisit next cycle' },
    { kind: 'decide', decision: 'kill-list', notes: 'committed for next sprint' },
    { kind: 'park', reason: 'needs more context' },
    { kind: 'decide', decision: 'close', notes: 'stale, closing' },
];

for (const a of actions) {
    const s = store.get(sessionId);
    if (!s?.activeItem) {
        console.log('  (queue exhausted)');
        break;
    }
    const curr = s.activeItem;
    if (a.kind === 'decide') {
        s.decisions[curr.number] = {
            decision: a.decision,
            notes: a.notes,
            decidedAt: Date.now(),
            sentinelWritten: false, // smoke-only, we don't actually write
        };
        console.log(
            `  decide #${curr.number} → ${a.decision}   "${a.notes}"`
        );
    } else if (a.kind === 'park') {
        s.queue.push(curr);
        s.parked.push(curr.number);
        console.log(`  park   #${curr.number}   "${a.reason}"`);
    }
    const next = s.queue.shift() ?? null;
    s.activeItem = next;
    s.activeItemSince = next ? Date.now() : null;
    store.update(s);
}

const final = store.end(sessionId);
console.log('\nfinal session:');
console.log(JSON.stringify(
    {
        decisions: Object.entries(final.decisions).map(([n, d]) => ({ number: Number(n), decision: d.decision })),
        parked: final.parked,
        remainingInQueue: final.queue.length,
    },
    null,
    2
));

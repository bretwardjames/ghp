#!/usr/bin/env node
/**
 * Smoke test: run the planning-audit logic end-to-end against a real repo
 * without standing up the full MCP stdio/HTTP server. Imports from the
 * built `dist/` of core (+ uses the bundled GitHubAPI class) so the path
 * exercised matches what Claude Desktop / runtight would hit.
 *
 * Usage:
 *   node scripts/test-planning-audit.mjs true-impact/care
 *   node scripts/test-planning-audit.mjs true-impact/care "Project Name"
 *
 * Auth: uses `gh auth token` by default. Override with GITHUB_TOKEN.
 */

import { execSync } from 'node:child_process';
import {
    GitHubAPI,
    planning,
} from '../packages/core/dist/index.js';

const [, , repoArg, projectArg] = process.argv;
if (!repoArg || !repoArg.includes('/')) {
    console.error('Usage: node scripts/test-planning-audit.mjs owner/name [project-title]');
    process.exit(1);
}
const [owner, name] = repoArg.split('/');
const repo = { owner, name, fullName: `${owner}/${name}` };

function resolveToken() {
    if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
    if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
    try {
        return execSync('gh auth token', { encoding: 'utf-8' }).trim();
    } catch {
        console.error('Could not resolve a GitHub token. Set GITHUB_TOKEN or run `gh auth login`.');
        process.exit(1);
    }
}

const token = resolveToken();
const api = new GitHubAPI({
    tokenProvider: { getToken: async () => token },
});
await api.authenticate();

console.log(`→ Fetching projects for ${repo.fullName}`);
const projects = await api.getProjects(repo);
if (projects.length === 0) {
    console.error(`No projects linked to ${repo.fullName}.`);
    process.exit(1);
}
const selected = projectArg
    ? projects.find((p) => p.title.toLowerCase() === projectArg.toLowerCase())
    : projects[0];
if (!selected) {
    console.error(
        `Project "${projectArg}" not found. Available: ${projects.map((p) => p.title).join(', ')}`
    );
    process.exit(1);
}
console.log(`  project: ${selected.title}  (id=${selected.id})`);

console.log('→ Probing project fields');
const fields = await api.getProjectFields(selected.id);
const probe = planning.probeProjectFields(selected.id, selected.title, fields);

console.log('→ Extracting iteration metadata');
const sprintField = fields.find(
    (f) =>
        f.name.toLowerCase() === 'sprint' &&
        (f.type.toLowerCase() === 'iteration' || f.dataType?.toLowerCase() === 'iteration')
);
const iterations = [];
let completedIterationCount = 0;
for (const iter of sprintField?.iterations ?? []) {
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

console.log('→ Fetching open milestones');
const warnings = [];
let milestones = [];
try {
    const ms = await api.listOpenMilestones(repo);
    milestones = ms.milestones;
    if (ms.truncated) {
        warnings.push('Milestone list truncated at 50');
    }
} catch (err) {
    warnings.push(`listOpenMilestones failed: ${err instanceof Error ? err.message : err}`);
}

console.log('→ Running timeline audit');
const timeline = planning.auditTimeline({
    iterations,
    completedIterationCount,
    milestones,
});

const report = { ...probe, timeline, ...(warnings.length ? { warnings } : {}) };
console.log('\n=== PLANNING AUDIT REPORT ===\n');
console.log(JSON.stringify(report, null, 2));

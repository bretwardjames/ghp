#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { GitHubAPI } from '../packages/core/dist/index.js';

const token = execSync('gh auth token', { encoding: 'utf-8' }).trim();
const api = new GitHubAPI({ tokenProvider: { getToken: async () => token } });
await api.authenticate();
const repo = { owner: 'Daxman95', name: 'PickleXP', fullName: 'Daxman95/PickleXP' };

const projects = await api.getProjects(repo);
const sel = projects[0];
const items = await api.getProjectItems(sel.id, sel.title);

const statusCounts = {};
const fieldKeys = new Set();
for (const it of items) {
    const s = it.status ?? '<null>';
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
    for (const k of Object.keys(it.fields)) fieldKeys.add(k);
}
console.log('status distribution:', statusCounts);
console.log('field keys on items:', [...fieldKeys]);

console.log('\nsample first 3 items:');
for (const it of items.slice(0, 3)) {
    console.log({
        number: it.number,
        title: it.title,
        status: it.status,
        assignees: it.assignees,
        fields: it.fields,
    });
}

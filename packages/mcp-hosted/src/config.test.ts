import { describe, it, expect } from 'vitest';
import { loadConfig, parseRepoInfo } from './config.js';

describe('loadConfig', () => {
    const base = {
        GHP_MCP_MODE: 'hosted',
        PORT: '3000',
        GHP_REPO: 'bretwardjames/ghp',
    };

    it('accepts a minimal dev config', () => {
        const cfg = loadConfig({ ...base });
        expect(cfg.mode).toBe('hosted');
        expect(cfg.port).toBe(3000);
        expect(cfg.lockedRepo).toBe('bretwardjames/ghp');
        expect(cfg.nodeEnv).toBe('development');
    });

    it('refuses to start when GHP_MCP_MODE is not hosted', () => {
        expect(() =>
            loadConfig({ ...base, GHP_MCP_MODE: 'local' })
        ).toThrow();
    });

    it('refuses to start when GHP_MCP_MODE is missing', () => {
        const { GHP_MCP_MODE: _omit, ...without } = base;
        expect(() => loadConfig(without)).toThrow();
    });

    it('requires https baseUrl in production', () => {
        expect(() =>
            loadConfig({ ...base, NODE_ENV: 'production' })
        ).toThrow(/GHP_HOSTED_BASE_URL/);

        expect(() =>
            loadConfig({
                ...base,
                NODE_ENV: 'production',
                GHP_HOSTED_BASE_URL: 'http://insecure.example.com',
            })
        ).toThrow(/https/);

        expect(() =>
            loadConfig({
                ...base,
                NODE_ENV: 'production',
                GHP_HOSTED_BASE_URL: 'https://ghp.example.com',
            })
        ).not.toThrow();
    });

    it('requires GHP_REPO', () => {
        const { GHP_REPO: _omit, ...without } = base;
        expect(() => loadConfig(without)).toThrow();
    });

    it('validates GHP_REPO format', () => {
        expect(() => loadConfig({ ...base, GHP_REPO: 'no-slash' })).toThrow();
    });
});

describe('parseRepoInfo', () => {
    it('splits owner/name', () => {
        expect(parseRepoInfo('bretwardjames/ghp')).toEqual({
            owner: 'bretwardjames',
            name: 'ghp',
            fullName: 'bretwardjames/ghp',
        });
    });

    it('handles repo names containing slashes', () => {
        // GitHub repo names cannot contain slashes, but guard against regression
        // in the parser if this ever changes.
        expect(parseRepoInfo('org/nested/repo')).toEqual({
            owner: 'org',
            name: 'nested/repo',
            fullName: 'org/nested/repo',
        });
    });
});

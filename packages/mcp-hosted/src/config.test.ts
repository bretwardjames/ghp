import { describe, it, expect } from 'vitest';
import { loadConfig, parseRepoInfo } from './config.js';

describe('loadConfig', () => {
    const base = {
        GHP_MCP_MODE: 'hosted',
        PORT: '3000',
        GHP_REPO: 'bretwardjames/ghp',
        GHP_GITHUB_OAUTH_CLIENT_ID: 'test-client-id',
        GHP_GITHUB_OAUTH_CLIENT_SECRET: 'test-client-secret',
        GHP_ALLOWED_REDIRECT_URIS: 'https://runtight.test/oauth/callback',
    };

    it('accepts a minimal dev config', () => {
        const cfg = loadConfig({ ...base });
        expect(cfg.mode).toBe('hosted');
        expect(cfg.port).toBe(3000); // coerced from the string '3000' in base
        expect(cfg.lockedRepo).toBe('bretwardjames/ghp');
        expect(cfg.nodeEnv).toBe('development');
    });

    it('defaults PORT to 8731 when unset', () => {
        const { PORT: _omit, ...withoutPort } = base;
        const cfg = loadConfig(withoutPort);
        expect(cfg.port).toBe(8731);
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

    it('requires GHP_GITHUB_OAUTH_CLIENT_ID', () => {
        const { GHP_GITHUB_OAUTH_CLIENT_ID: _omit, ...without } = base;
        expect(() => loadConfig(without)).toThrow();
    });

    it('requires GHP_GITHUB_OAUTH_CLIENT_SECRET', () => {
        const { GHP_GITHUB_OAUTH_CLIENT_SECRET: _omit, ...without } = base;
        expect(() => loadConfig(without)).toThrow();
    });

    it('requires GHP_ALLOWED_REDIRECT_URIS', () => {
        const { GHP_ALLOWED_REDIRECT_URIS: _omit, ...without } = base;
        expect(() => loadConfig(without)).toThrow();
    });

    it('oauthStateTtlSeconds defaults to 600', () => {
        const cfg = loadConfig({ ...base });
        expect(cfg.oauthStateTtlSeconds).toBe(600);
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

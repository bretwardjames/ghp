import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { assertHostedSafe, assertHostedMode } from './mode-guard.js';

describe('assertHostedSafe', () => {
    it('accepts pure-api tools', () => {
        expect(() =>
            assertHostedSafe({ name: 'get_my_work', capability: 'pure-api' })
        ).not.toThrow();
    });

    it('rejects local-only tools with a loud error', () => {
        expect(() =>
            assertHostedSafe({ name: 'create_worktree', capability: 'local-only' })
        ).toThrow(/create_worktree.*local-only.*hosted/s);
    });
});

describe('assertHostedMode', () => {
    const original = process.env.GHP_MCP_MODE;
    beforeEach(() => {
        delete process.env.GHP_MCP_MODE;
    });
    afterEach(() => {
        if (original === undefined) {
            delete process.env.GHP_MCP_MODE;
        } else {
            process.env.GHP_MCP_MODE = original;
        }
    });

    it('accepts GHP_MCP_MODE=hosted', () => {
        process.env.GHP_MCP_MODE = 'hosted';
        expect(() => assertHostedMode()).not.toThrow();
    });

    it('refuses when GHP_MCP_MODE is anything else', () => {
        process.env.GHP_MCP_MODE = 'local';
        expect(() => assertHostedMode()).toThrow(/GHP_MCP_MODE=hosted/);
    });

    it('refuses when GHP_MCP_MODE is unset', () => {
        expect(() => assertHostedMode()).toThrow(/GHP_MCP_MODE=hosted/);
    });
});

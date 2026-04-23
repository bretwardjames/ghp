import { describe, it, expect } from 'vitest';
import { BearerTokenProvider, extractBearer } from './bearer-token-provider.js';

describe('extractBearer', () => {
    it('extracts token from well-formed header', () => {
        expect(extractBearer('Bearer ghp_somelongtokenvalue123')).toBe(
            'ghp_somelongtokenvalue123'
        );
    });

    it('is case-insensitive on the scheme', () => {
        expect(extractBearer('bearer ghp_somelongtokenvalue123')).toBe(
            'ghp_somelongtokenvalue123'
        );
        expect(extractBearer('BEARER ghp_somelongtokenvalue123')).toBe(
            'ghp_somelongtokenvalue123'
        );
    });

    it('returns null for missing header', () => {
        expect(extractBearer(undefined)).toBeNull();
        expect(extractBearer('')).toBeNull();
    });

    it('returns null for wrong scheme', () => {
        expect(extractBearer('Basic dXNlcjpwYXNz')).toBeNull();
    });

    it('returns null for too-short tokens', () => {
        expect(extractBearer('Bearer short')).toBeNull();
    });

    it('returns null for bearer with no token', () => {
        expect(extractBearer('Bearer ')).toBeNull();
        expect(extractBearer('Bearer')).toBeNull();
    });
});

describe('BearerTokenProvider', () => {
    it('returns the wrapped token', async () => {
        const p = new BearerTokenProvider('ghp_abc123');
        expect(await p.getToken()).toBe('ghp_abc123');
    });

    it('refuses to construct with empty token (multi-tenancy guard)', () => {
        expect(() => new BearerTokenProvider('')).toThrow();
    });
});

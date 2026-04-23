import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { verifyPkce, isValidChallenge } from './pkce.js';

function computeChallenge(verifier: string): string {
    return createHash('sha256')
        .update(verifier)
        .digest('base64')
        .replace(/=+$/, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

const VERIFIER = 'a'.repeat(64); // valid: 43..128 chars, unreserved
const CHALLENGE = computeChallenge(VERIFIER);

describe('verifyPkce', () => {
    it('accepts a matching S256 verifier', () => {
        expect(verifyPkce(VERIFIER, CHALLENGE)).toBe(true);
    });

    it('rejects a mismatched verifier', () => {
        expect(verifyPkce('b'.repeat(64), CHALLENGE)).toBe(false);
    });

    it('rejects verifier that is too short (< 43 chars)', () => {
        const short = 'a'.repeat(42);
        expect(verifyPkce(short, computeChallenge(short))).toBe(false);
    });

    it('rejects verifier that is too long (> 128 chars)', () => {
        const long = 'a'.repeat(129);
        expect(verifyPkce(long, computeChallenge(long))).toBe(false);
    });

    it('rejects verifier containing a disallowed character (at a valid length)', () => {
        // 43 chars, includes '!' which is NOT in the RFC 7636 unreserved set.
        // Should fail purely on charset, not length.
        const bad = 'a'.repeat(42) + '!';
        expect(bad.length).toBe(43);
        expect(verifyPkce(bad, computeChallenge(bad))).toBe(false);
    });

    it('rejects when method is not S256', () => {
        expect(verifyPkce(VERIFIER, VERIFIER, 'plain')).toBe(false);
    });
});

describe('isValidChallenge', () => {
    it('accepts a base64url-encoded SHA-256 digest (43 chars)', () => {
        expect(isValidChallenge(CHALLENGE)).toBe(true);
    });

    it('rejects wrong-length challenges', () => {
        expect(isValidChallenge('a'.repeat(42))).toBe(false);
        expect(isValidChallenge('a'.repeat(44))).toBe(false);
    });

    it('rejects challenges with non-base64url chars', () => {
        // base64url alphabet does NOT include '+', '/', or '='
        const invalid = 'a'.repeat(41) + '+/=';
        expect(invalid.length).toBe(44);
        expect(isValidChallenge(invalid)).toBe(false);
    });

    it('rejects empty string', () => {
        expect(isValidChallenge('')).toBe(false);
    });
});

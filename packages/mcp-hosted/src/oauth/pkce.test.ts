import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { verifyPkce } from './pkce.js';

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

    it('rejects verifier with disallowed characters', () => {
        const bad = 'a'.repeat(43) + '!';
        expect(verifyPkce(bad.slice(0, 43), computeChallenge(bad.slice(0, 43)))).toBe(true);
        expect(verifyPkce(bad, computeChallenge(bad))).toBe(false);
    });

    it('rejects when method is not S256', () => {
        expect(verifyPkce(VERIFIER, VERIFIER, 'plain')).toBe(false);
    });
});

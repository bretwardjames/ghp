import { createHash, timingSafeEqual } from 'crypto';

/**
 * Verify a PKCE code_verifier against the code_challenge stored at
 * authorize time.
 *
 * Only S256 is supported (plain is deprecated by OAuth 2.1). The
 * comparison uses a constant-time equality check to avoid leaking
 * timing information about the stored challenge.
 */
export function verifyPkce(
    verifier: string,
    challenge: string,
    method: string = 'S256'
): boolean {
    if (method !== 'S256') return false;
    if (!isValidVerifier(verifier)) return false;

    const computed = base64UrlSha256(verifier);
    const expectedBuf = Buffer.from(challenge);
    const computedBuf = Buffer.from(computed);

    if (expectedBuf.length !== computedBuf.length) return false;
    return timingSafeEqual(expectedBuf, computedBuf);
}

/**
 * RFC 7636 §4.1: code_verifier = 43..128 chars, unreserved URL chars.
 * A short or non-conforming verifier is rejected outright — guards
 * against a client sending garbage that would silently hash to
 * something.
 */
function isValidVerifier(verifier: string): boolean {
    if (verifier.length < 43 || verifier.length > 128) return false;
    return /^[A-Za-z0-9\-._~]+$/.test(verifier);
}

function base64UrlSha256(input: string): string {
    return createHash('sha256')
        .update(input)
        .digest('base64')
        .replace(/=+$/, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

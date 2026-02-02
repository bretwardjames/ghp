import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    isTransientError,
    parseRateLimitDelay,
    calculateBackoffDelay,
    withRetry,
    wrapWithRetry,
    DEFAULT_RETRY_CONFIG,
} from './retry.js';

describe('isTransientError', () => {
    it('returns false for null/undefined', () => {
        expect(isTransientError(null)).toBe(false);
        expect(isTransientError(undefined)).toBe(false);
    });

    it('returns false for non-object errors', () => {
        expect(isTransientError('string error')).toBe(false);
        expect(isTransientError(123)).toBe(false);
    });

    it('detects network error codes', () => {
        expect(isTransientError({ code: 'ECONNREFUSED' })).toBe(true);
        expect(isTransientError({ code: 'ECONNRESET' })).toBe(true);
        expect(isTransientError({ code: 'ETIMEDOUT' })).toBe(true);
        expect(isTransientError({ code: 'ENOTFOUND' })).toBe(true);
        expect(isTransientError({ code: 'EHOSTUNREACH' })).toBe(true);
        expect(isTransientError({ code: 'EAI_AGAIN' })).toBe(true);
    });

    it('returns false for non-transient error codes', () => {
        expect(isTransientError({ code: 'ENOENT' })).toBe(false);
        expect(isTransientError({ code: 'EPERM' })).toBe(false);
    });

    it('detects HTTP 429 (rate limited)', () => {
        expect(isTransientError({ status: 429 })).toBe(true);
        expect(isTransientError({ statusCode: 429 })).toBe(true);
        expect(isTransientError({ response: { status: 429 } })).toBe(true);
    });

    it('detects HTTP 5xx (server errors)', () => {
        expect(isTransientError({ status: 500 })).toBe(true);
        expect(isTransientError({ status: 502 })).toBe(true);
        expect(isTransientError({ status: 503 })).toBe(true);
        expect(isTransientError({ status: 504 })).toBe(true);
    });

    it('returns false for HTTP 4xx (except 429)', () => {
        expect(isTransientError({ status: 400 })).toBe(false);
        expect(isTransientError({ status: 401 })).toBe(false);
        expect(isTransientError({ status: 403 })).toBe(false);
        expect(isTransientError({ status: 404 })).toBe(false);
    });

    it('detects 403 with rate limit headers as transient', () => {
        expect(
            isTransientError({
                status: 403,
                headers: { 'x-ratelimit-remaining': '0' },
            })
        ).toBe(true);
    });

    it('returns false for 403 without rate limit headers', () => {
        expect(isTransientError({ status: 403 })).toBe(false);
        expect(isTransientError({ status: 403, headers: {} })).toBe(false);
    });

    it('detects network error messages', () => {
        expect(isTransientError({ message: 'ECONNREFUSED: connection refused' })).toBe(true);
        expect(isTransientError({ message: 'ETIMEDOUT: timed out' })).toBe(true);
        expect(isTransientError({ message: 'network error occurred' })).toBe(true);
        expect(isTransientError({ message: 'socket hang up' })).toBe(true);
        expect(isTransientError({ message: 'getaddrinfo failed' })).toBe(true);
    });

    it('detects GraphQL rate limit errors', () => {
        expect(
            isTransientError({
                errors: [{ type: 'RATE_LIMITED' }],
            })
        ).toBe(true);

        expect(
            isTransientError({
                errors: [{ message: 'API rate limit exceeded' }],
            })
        ).toBe(true);
    });

    it('returns false for other GraphQL errors', () => {
        expect(
            isTransientError({
                errors: [{ type: 'NOT_FOUND' }],
            })
        ).toBe(false);

        expect(
            isTransientError({
                errors: [{ type: 'INSUFFICIENT_SCOPES' }],
            })
        ).toBe(false);
    });
});

describe('parseRateLimitDelay', () => {
    it('returns null for non-objects', () => {
        expect(parseRateLimitDelay(null)).toBe(null);
        expect(parseRateLimitDelay(undefined)).toBe(null);
        expect(parseRateLimitDelay('error')).toBe(null);
    });

    it('returns null when no headers present', () => {
        expect(parseRateLimitDelay({})).toBe(null);
        expect(parseRateLimitDelay({ status: 429 })).toBe(null);
    });

    it('parses Retry-After header (seconds)', () => {
        expect(
            parseRateLimitDelay({
                headers: { 'retry-after': '5' },
            })
        ).toBe(5000);

        expect(
            parseRateLimitDelay({
                headers: { 'Retry-After': '10' },
            })
        ).toBe(10000);
    });

    it('parses X-RateLimit-Reset header (Unix timestamp)', () => {
        const futureTimestamp = Math.floor(Date.now() / 1000) + 60; // 60 seconds from now
        const delay = parseRateLimitDelay({
            headers: { 'x-ratelimit-reset': String(futureTimestamp) },
        });

        // Should be approximately 60 seconds (allow some tolerance)
        expect(delay).toBeGreaterThan(59000);
        expect(delay).toBeLessThan(61000);
    });

    it('handles headers in response object', () => {
        expect(
            parseRateLimitDelay({
                response: { headers: { 'retry-after': '3' } },
            })
        ).toBe(3000);
    });
});

describe('calculateBackoffDelay', () => {
    it('calculates exponential backoff', () => {
        // With no jitter, delay = baseDelay * 2^attempt
        // But jitter is 0.5-1.0, so result is in range [half, full]
        const base = 1000;
        const max = 30000;

        // Attempt 0: 1000 * 2^0 = 1000 -> [500, 1000]
        const delay0 = calculateBackoffDelay(0, base, max);
        expect(delay0).toBeGreaterThanOrEqual(500);
        expect(delay0).toBeLessThanOrEqual(1000);

        // Attempt 1: 1000 * 2^1 = 2000 -> [1000, 2000]
        const delay1 = calculateBackoffDelay(1, base, max);
        expect(delay1).toBeGreaterThanOrEqual(1000);
        expect(delay1).toBeLessThanOrEqual(2000);

        // Attempt 2: 1000 * 2^2 = 4000 -> [2000, 4000]
        const delay2 = calculateBackoffDelay(2, base, max);
        expect(delay2).toBeGreaterThanOrEqual(2000);
        expect(delay2).toBeLessThanOrEqual(4000);
    });

    it('caps at maxDelay', () => {
        const base = 1000;
        const max = 5000;

        // Attempt 10: 1000 * 2^10 = 1024000, but capped at 5000 -> [2500, 5000]
        const delay = calculateBackoffDelay(10, base, max);
        expect(delay).toBeGreaterThanOrEqual(2500);
        expect(delay).toBeLessThanOrEqual(5000);
    });
});

describe('withRetry', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns result on first success', async () => {
        const fn = vi.fn().mockResolvedValue('success');

        const promise = withRetry(fn);
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on transient errors', async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce({ status: 503 })
            .mockRejectedValueOnce({ status: 503 })
            .mockResolvedValue('success');

        const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000 });

        // Advance timers to allow retries
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws immediately on non-transient errors', async () => {
        const fn = vi.fn().mockRejectedValue({ status: 404, message: 'Not found' });

        const promise = withRetry(fn, { maxRetries: 3 });

        await expect(promise).rejects.toEqual({ status: 404, message: 'Not found' });
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('throws after max retries exhausted', async () => {
        // Use real timers with short delays to avoid unhandled rejection warnings
        vi.useRealTimers();

        const transientError = { status: 503 };
        const fn = vi.fn().mockRejectedValue(transientError);

        await expect(
            withRetry(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 })
        ).rejects.toEqual(transientError);
        expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries

        // Restore fake timers for other tests
        vi.useFakeTimers();
    });

    it('calls onRetry callback', async () => {
        const onRetry = vi.fn();
        const fn = vi
            .fn()
            .mockRejectedValueOnce({ status: 503 })
            .mockResolvedValue('success');

        const promise = withRetry(fn, {
            maxRetries: 3,
            baseDelayMs: 100,
            maxDelayMs: 1000,
            onRetry,
        });

        await vi.runAllTimersAsync();
        await promise;

        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledWith(
            { status: 503 },
            1, // attempt number
            expect.any(Number) // delay
        );
    });

    it('uses rate limit delay when available', async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce({
                status: 429,
                headers: { 'retry-after': '2' },
            })
            .mockResolvedValue('success');

        const onRetry = vi.fn();
        const promise = withRetry(fn, {
            maxRetries: 3,
            baseDelayMs: 100,
            maxDelayMs: 5000,
            onRetry,
        });

        await vi.runAllTimersAsync();
        await promise;

        // Should use rate limit delay (2000ms) instead of backoff (100ms)
        expect(onRetry).toHaveBeenCalledWith(
            expect.anything(),
            1,
            2000 // From Retry-After header
        );
    });

    it('caps rate limit delay at maxDelayMs', async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce({
                status: 429,
                headers: { 'retry-after': '60' }, // 60 seconds
            })
            .mockResolvedValue('success');

        const onRetry = vi.fn();
        const promise = withRetry(fn, {
            maxRetries: 3,
            baseDelayMs: 100,
            maxDelayMs: 5000, // Cap at 5 seconds
            onRetry,
        });

        await vi.runAllTimersAsync();
        await promise;

        // Should cap at maxDelayMs
        expect(onRetry).toHaveBeenCalledWith(
            expect.anything(),
            1,
            5000 // Capped
        );
    });
});

describe('wrapWithRetry', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('creates a retry-wrapped function', async () => {
        const original = vi
            .fn()
            .mockRejectedValueOnce({ status: 503 })
            .mockResolvedValue('success');

        const wrapped = wrapWithRetry(original, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000 });

        const promise = wrapped('arg1', 'arg2');
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result).toBe('success');
        expect(original).toHaveBeenCalledWith('arg1', 'arg2');
        expect(original).toHaveBeenCalledTimes(2);
    });
});

describe('DEFAULT_RETRY_CONFIG', () => {
    it('has sensible defaults', () => {
        expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
        expect(DEFAULT_RETRY_CONFIG.baseDelayMs).toBe(1000);
        expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBe(30000);
    });
});

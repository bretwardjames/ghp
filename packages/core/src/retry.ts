/**
 * Retry utilities for transient GitHub API failures.
 *
 * Provides exponential backoff with jitter for:
 * - Rate limiting (429, 403 with rate-limit headers)
 * - Server errors (5xx)
 * - Network errors (ECONNREFUSED, ETIMEDOUT, etc.)
 */

import type { RetryConfig } from './types.js';

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
};

/**
 * Network error codes that indicate transient failures
 */
const TRANSIENT_NETWORK_ERRORS = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EAI_AGAIN',
    'EPIPE',
    'EPROTO',
]);

/**
 * HTTP status codes that indicate transient failures
 */
const TRANSIENT_HTTP_CODES = new Set([
    429, // Too Many Requests (rate limited)
    500, // Internal Server Error
    502, // Bad Gateway
    503, // Service Unavailable
    504, // Gateway Timeout
]);

/**
 * Determines if an error is transient and should be retried.
 *
 * Retries:
 * - HTTP 429 (rate limited)
 * - HTTP 5xx (server errors)
 * - Network errors (connection refused, timeout, DNS, etc.)
 *
 * Does NOT retry:
 * - HTTP 401/403 (auth errors, unless rate-limited 403)
 * - HTTP 404 (not found)
 * - GraphQL errors (INSUFFICIENT_SCOPES, NOT_FOUND, etc.)
 * - Validation errors
 */
export function isTransientError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const err = error as Record<string, unknown>;

    // Check for network errors (Node.js style)
    if (typeof err.code === 'string' && TRANSIENT_NETWORK_ERRORS.has(err.code)) {
        return true;
    }

    // Check for HTTP status codes
    const status = err.status ?? err.statusCode ?? (err.response as Record<string, unknown>)?.status;
    if (typeof status === 'number') {
        // Special case: 403 can be rate limiting if it has rate-limit headers
        if (status === 403 && hasRateLimitHeaders(error)) {
            return true;
        }
        return TRANSIENT_HTTP_CODES.has(status);
    }

    // Check for fetch/network errors by message patterns
    const message = String(err.message ?? '');
    if (
        message.includes('ECONNREFUSED') ||
        message.includes('ETIMEDOUT') ||
        message.includes('network') ||
        message.includes('socket hang up') ||
        message.includes('getaddrinfo')
    ) {
        return true;
    }

    // Check for GraphQL rate limit errors
    if (Array.isArray(err.errors)) {
        const gqlErrors = err.errors as Array<{ type?: string; message?: string }>;
        return gqlErrors.some(
            e => e.type === 'RATE_LIMITED' || e.message?.toLowerCase().includes('rate limit')
        );
    }

    return false;
}

/**
 * Checks if an error response contains rate limit headers
 */
function hasRateLimitHeaders(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const err = error as Record<string, unknown>;
    const headers =
        (err.headers as Record<string, unknown>) ??
        ((err.response as Record<string, unknown>)?.headers as Record<string, unknown>);

    if (!headers) {
        return false;
    }

    // GitHub rate limit headers (case-insensitive check)
    const headerKeys = Object.keys(headers).map(k => k.toLowerCase());
    return (
        headerKeys.includes('x-ratelimit-remaining') ||
        headerKeys.includes('x-ratelimit-reset') ||
        headerKeys.includes('retry-after')
    );
}

/**
 * Extracts the recommended retry delay from rate limit headers.
 * Returns delay in milliseconds, or null if not available.
 */
export function parseRateLimitDelay(error: unknown): number | null {
    if (!error || typeof error !== 'object') {
        return null;
    }

    const err = error as Record<string, unknown>;
    const headers =
        (err.headers as Record<string, unknown>) ??
        ((err.response as Record<string, unknown>)?.headers as Record<string, unknown>);

    if (!headers) {
        return null;
    }

    // Normalize header keys to lowercase
    const normalizedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        if (typeof value === 'string') {
            normalizedHeaders[key.toLowerCase()] = value;
        }
    }

    // Check Retry-After header (seconds)
    const retryAfter = normalizedHeaders['retry-after'];
    if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds)) {
            return seconds * 1000;
        }
    }

    // Check X-RateLimit-Reset header (Unix timestamp)
    const resetTimestamp = normalizedHeaders['x-ratelimit-reset'];
    if (resetTimestamp) {
        const resetTime = parseInt(resetTimestamp, 10) * 1000; // Convert to ms
        const now = Date.now();
        if (resetTime > now) {
            return resetTime - now;
        }
    }

    return null;
}

/**
 * Calculates delay with exponential backoff and jitter.
 *
 * Formula: min(maxDelay, baseDelay * 2^attempt) * (0.5 + random(0.5))
 *
 * The jitter prevents thundering herd when multiple clients retry simultaneously.
 */
export function calculateBackoffDelay(
    attempt: number,
    baseDelayMs: number,
    maxDelayMs: number
): number {
    // Cap attempt to prevent integer overflow (2^31 ms ≈ 25 days, well beyond any maxDelayMs)
    const safeAttempt = Math.min(attempt, 31);

    // Exponential backoff: baseDelay * 2^attempt
    const exponentialDelay = baseDelayMs * Math.pow(2, safeAttempt);

    // Cap at maxDelay
    const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

    // Add jitter: multiply by random factor between 0.5 and 1.0
    const jitter = 0.5 + Math.random() * 0.5;

    return Math.floor(cappedDelay * jitter);
}

/**
 * Delays execution for the specified number of milliseconds.
 */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wraps an async function with retry logic for transient failures.
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => this.graphqlWithAuth(query, params),
 *   { maxRetries: 3 }
 * );
 * ```
 *
 * @param fn - The async function to execute
 * @param config - Retry configuration (optional, uses defaults)
 * @returns The result of the function, or throws after all retries exhausted
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    config: Partial<RetryConfig> = {}
): Promise<T> {
    const { maxRetries, baseDelayMs, maxDelayMs, onRetry } = {
        ...DEFAULT_RETRY_CONFIG,
        ...config,
    };

    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // Don't retry if this isn't a transient error
            if (!isTransientError(error)) {
                throw error;
            }

            // Don't retry if we've exhausted attempts
            if (attempt >= maxRetries) {
                throw error;
            }

            // Calculate delay (use rate limit header if available, otherwise backoff)
            let delayMs = parseRateLimitDelay(error);
            if (delayMs === null) {
                delayMs = calculateBackoffDelay(attempt, baseDelayMs, maxDelayMs);
            } else {
                // Cap rate limit delay at maxDelay
                delayMs = Math.min(delayMs, maxDelayMs);
            }

            // Notify caller of retry (for logging/metrics)
            if (onRetry) {
                onRetry(error, attempt + 1, delayMs);
            }

            await delay(delayMs);
        }
    }

    // This should never be reached, but TypeScript needs it
    throw lastError;
}

/**
 * Creates a retry-wrapped version of an async function.
 *
 * @example
 * ```typescript
 * const fetchWithRetry = wrapWithRetry(fetch, { maxRetries: 3 });
 * const response = await fetchWithRetry('https://api.github.com/...');
 * ```
 */
export function wrapWithRetry<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => Promise<TResult>,
    config: Partial<RetryConfig> = {}
): (...args: TArgs) => Promise<TResult> {
    return (...args: TArgs) => withRetry(() => fn(...args), config);
}

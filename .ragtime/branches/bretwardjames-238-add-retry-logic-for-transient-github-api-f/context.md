---
type: context
branch: bretwardjames/238-add-retry-logic-for-transient-github-api-f
issue: 238
status: active
created: '2026-02-02'
author: bretwardjames
---

## Issue

**#238**: Add retry logic for transient GitHub API failures



## Description

The codebase currently has no retry logic for GitHub API calls. All 40+ API methods in `packages/core/src/github-api.ts` catch errors and return `null`/`false`/`[]`, making transient failures indistinguishable from real "not found" scenarios.

This issue adds centralized retry logic with exponential backoff for transient errors:
- Rate limiting (429, 403 with rate-limit headers)
- Server errors (5xx)
- Network errors (ECONNREFUSED, ETIMEDOUT, etc.)

<!-- ghp-branch: bretwardjames/238-add-retry-logic-for-transient-github-api-f -->

## Plan

### 1. Create retry utility module (`packages/core/src/retry.ts`)
- `RetryConfig` interface (maxRetries, baseDelay, maxDelay, shouldRetry predicate)
- `withRetry<T>()` higher-order function wrapping async operations
- Exponential backoff with jitter implementation
- `isTransientError()` - detects retryable errors vs permanent failures
- `parseRateLimitHeaders()` - extracts reset time from GitHub responses

### 2. Integrate retry into `GitHubAPI` class
- Wrap `graphqlWithAuth` calls with retry logic
- Wrap REST `fetch` calls (ensureLabel, etc.) with retry logic
- Add optional `RetryConfig` to `GitHubAPIOptions`
- Default config: 3 retries, 1s base delay, 30s max delay

### 3. Export retry utilities from core package
- Export `withRetry`, `isTransientError`, `RetryConfig` from `index.ts`
- Allow CLI/MCP to customize retry behavior if needed

### 4. Add tests for retry behavior
- Test exponential backoff timing
- Test transient error detection
- Test rate limit header parsing
- Test max retries exhaustion

## Acceptance Criteria

- [x] Transient errors (429, 5xx, network) are automatically retried
- [x] Permanent errors (401, 404, auth errors) are NOT retried
- [x] Rate limit 429s respect `X-RateLimit-Reset` header
- [x] Exponential backoff with jitter prevents thundering herd
- [x] Max retry limit prevents infinite loops
- [x] Existing API behavior preserved (same return types)
- [x] Unit tests cover retry scenarios (28 tests)

## Notes

### Key Files
- `packages/core/src/github-api.ts` - Main API client (40+ methods with catch blocks)
- `packages/core/src/queries.ts` - GraphQL query templates
- `packages/core/src/index.ts` - Package exports

### Design Decisions
- **Centralized approach** - Single retry utility vs per-method logic
- **Transparent retries** - Same return types, no API changes
- **Conservative defaults** - 3 retries, exponential backoff to avoid abuse


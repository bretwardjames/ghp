/**
 * Tests for hook executor, specifically the onFailure behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeHooksForEvent, executeEventHook } from './executor.js';
import type { EventHook, IssueCreatedPayload, EventHookSettings } from './types.js';

// Mock the registry module
vi.mock('./registry.js', () => ({
    getHooksForEvent: vi.fn(),
    getEventSettings: vi.fn(),
}));

import { getHooksForEvent, getEventSettings } from './registry.js';

const mockPayload: IssueCreatedPayload = {
    repo: 'owner/repo',
    issue: {
        number: 123,
        title: 'Test Issue',
        body: 'Test body',
        url: 'https://github.com/owner/repo/issues/123',
    },
};

// Mock child_process.spawn
vi.mock('child_process', async () => {
    const actual = await vi.importActual<typeof import('child_process')>('child_process');
    return {
        ...actual,
        spawn: vi.fn(),
    };
});

import { spawn } from 'child_process';

/**
 * Create a mock spawn that simulates a command execution
 */
function mockSpawnWithExitCode(exitCode: number, stdout = '', stderr = '') {
    vi.mocked(spawn).mockImplementation(() => {
        const mockChild = {
            stdout: {
                on: vi.fn((event, cb) => {
                    if (event === 'data' && stdout) {
                        cb(Buffer.from(stdout));
                    }
                }),
            },
            stderr: {
                on: vi.fn((event, cb) => {
                    if (event === 'data' && stderr) {
                        cb(Buffer.from(stderr));
                    }
                }),
            },
            stdin: { write: vi.fn(), end: vi.fn() },
            on: vi.fn((event, cb) => {
                if (event === 'close') {
                    // Simulate async completion
                    setTimeout(() => cb(exitCode), 0);
                }
            }),
            kill: vi.fn(),
        };
        return mockChild as any;
    });
}

describe('executeHooksForEvent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getEventSettings).mockReturnValue(undefined);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('fail-fast behavior (default)', () => {
        it('should stop on first hook failure with default fail-fast', async () => {
            const hooks: EventHook[] = [
                { name: 'hook1', event: 'issue-created', command: 'echo hook1', enabled: true, mode: 'blocking' },
                { name: 'hook2', event: 'issue-created', command: 'echo hook2', enabled: true, mode: 'blocking' },
                { name: 'hook3', event: 'issue-created', command: 'echo hook3', enabled: true, mode: 'blocking' },
            ];

            vi.mocked(getHooksForEvent).mockReturnValue(hooks);

            // First hook succeeds, second fails, third should not run
            let callCount = 0;
            vi.mocked(spawn).mockImplementation(() => {
                callCount++;
                const exitCode = callCount === 2 ? 1 : 0; // Second hook fails
                const mockChild = {
                    stdout: { on: vi.fn() },
                    stderr: { on: vi.fn() },
                    stdin: { write: vi.fn(), end: vi.fn() },
                    on: vi.fn((event, cb) => {
                        if (event === 'close') setTimeout(() => cb(exitCode), 0);
                    }),
                    kill: vi.fn(),
                };
                return mockChild as any;
            });

            const results = await executeHooksForEvent('issue-created', mockPayload);

            // With fail-fast, should stop after second hook
            expect(results).toHaveLength(2);
            expect(results[0].hookName).toBe('hook1');
            expect(results[0].aborted).toBe(false);
            expect(results[1].hookName).toBe('hook2');
            expect(results[1].aborted).toBe(true);
        });

        it('should stop on first hook failure with explicit fail-fast option', async () => {
            const hooks: EventHook[] = [
                { name: 'hook1', event: 'issue-created', command: 'echo hook1', enabled: true, mode: 'blocking' },
                { name: 'hook2', event: 'issue-created', command: 'echo hook2', enabled: true, mode: 'blocking' },
            ];

            vi.mocked(getHooksForEvent).mockReturnValue(hooks);

            let callCount = 0;
            vi.mocked(spawn).mockImplementation(() => {
                callCount++;
                const exitCode = callCount === 1 ? 1 : 0; // First hook fails
                const mockChild = {
                    stdout: { on: vi.fn() },
                    stderr: { on: vi.fn() },
                    stdin: { write: vi.fn(), end: vi.fn() },
                    on: vi.fn((event, cb) => {
                        if (event === 'close') setTimeout(() => cb(exitCode), 0);
                    }),
                    kill: vi.fn(),
                };
                return mockChild as any;
            });

            const results = await executeHooksForEvent('issue-created', mockPayload, {
                onFailure: 'fail-fast',
            });

            // Should stop after first hook
            expect(results).toHaveLength(1);
            expect(results[0].aborted).toBe(true);
        });
    });

    describe('continue behavior', () => {
        it('should run all hooks when onFailure is continue', async () => {
            const hooks: EventHook[] = [
                { name: 'hook1', event: 'issue-created', command: 'exit 1', enabled: true, mode: 'blocking' },
                { name: 'hook2', event: 'issue-created', command: 'exit 1', enabled: true, mode: 'blocking' },
                { name: 'hook3', event: 'issue-created', command: 'exit 0', enabled: true, mode: 'blocking' },
            ];

            vi.mocked(getHooksForEvent).mockReturnValue(hooks);

            let callCount = 0;
            vi.mocked(spawn).mockImplementation(() => {
                callCount++;
                // First two fail, third succeeds
                const exitCode = callCount <= 2 ? 1 : 0;
                const mockChild = {
                    stdout: { on: vi.fn() },
                    stderr: { on: vi.fn() },
                    stdin: { write: vi.fn(), end: vi.fn() },
                    on: vi.fn((event, cb) => {
                        if (event === 'close') setTimeout(() => cb(exitCode), 0);
                    }),
                    kill: vi.fn(),
                };
                return mockChild as any;
            });

            const results = await executeHooksForEvent('issue-created', mockPayload, {
                onFailure: 'continue',
            });

            // All hooks should run with continue mode
            expect(results).toHaveLength(3);
            expect(results[0].hookName).toBe('hook1');
            expect(results[0].aborted).toBe(true); // First hook signaled abort
            expect(results[1].hookName).toBe('hook2');
            expect(results[1].aborted).toBe(true); // Second hook signaled abort
            expect(results[2].hookName).toBe('hook3');
            expect(results[2].aborted).toBe(false); // Third hook succeeded
        });

        it('should collect all failures when onFailure is continue', async () => {
            const hooks: EventHook[] = [
                { name: 'failing1', event: 'issue-created', command: 'exit 1', enabled: true, mode: 'blocking' },
                { name: 'failing2', event: 'issue-created', command: 'exit 1', enabled: true, mode: 'blocking' },
            ];

            vi.mocked(getHooksForEvent).mockReturnValue(hooks);

            vi.mocked(spawn).mockImplementation(() => {
                const mockChild = {
                    stdout: { on: vi.fn() },
                    stderr: { on: vi.fn() },
                    stdin: { write: vi.fn(), end: vi.fn() },
                    on: vi.fn((event, cb) => {
                        if (event === 'close') setTimeout(() => cb(1), 0); // All fail
                    }),
                    kill: vi.fn(),
                };
                return mockChild as any;
            });

            const results = await executeHooksForEvent('issue-created', mockPayload, {
                onFailure: 'continue',
            });

            // Both hooks should run and report failure
            expect(results).toHaveLength(2);
            expect(results.filter(r => r.aborted)).toHaveLength(2);
        });
    });

    describe('per-event override', () => {
        it('should use per-event setting over options', async () => {
            const hooks: EventHook[] = [
                { name: 'hook1', event: 'issue-created', command: 'exit 1', enabled: true, mode: 'blocking' },
                { name: 'hook2', event: 'issue-created', command: 'exit 0', enabled: true, mode: 'blocking' },
            ];

            vi.mocked(getHooksForEvent).mockReturnValue(hooks);
            // Per-event setting says continue
            vi.mocked(getEventSettings).mockReturnValue({ onFailure: 'continue' });

            let callCount = 0;
            vi.mocked(spawn).mockImplementation(() => {
                callCount++;
                const exitCode = callCount === 1 ? 1 : 0;
                const mockChild = {
                    stdout: { on: vi.fn() },
                    stderr: { on: vi.fn() },
                    stdin: { write: vi.fn(), end: vi.fn() },
                    on: vi.fn((event, cb) => {
                        if (event === 'close') setTimeout(() => cb(exitCode), 0);
                    }),
                    kill: vi.fn(),
                };
                return mockChild as any;
            });

            // Even though options say fail-fast, per-event says continue
            const results = await executeHooksForEvent('issue-created', mockPayload, {
                onFailure: 'fail-fast',
            });

            // Per-event override should take precedence - both hooks should run
            expect(results).toHaveLength(2);
        });

        it('should use per-event fail-fast over options continue', async () => {
            const hooks: EventHook[] = [
                { name: 'hook1', event: 'issue-created', command: 'exit 1', enabled: true, mode: 'blocking' },
                { name: 'hook2', event: 'issue-created', command: 'exit 0', enabled: true, mode: 'blocking' },
            ];

            vi.mocked(getHooksForEvent).mockReturnValue(hooks);
            // Per-event setting says fail-fast
            vi.mocked(getEventSettings).mockReturnValue({ onFailure: 'fail-fast' });

            let callCount = 0;
            vi.mocked(spawn).mockImplementation(() => {
                callCount++;
                const exitCode = callCount === 1 ? 1 : 0;
                const mockChild = {
                    stdout: { on: vi.fn() },
                    stderr: { on: vi.fn() },
                    stdin: { write: vi.fn(), end: vi.fn() },
                    on: vi.fn((event, cb) => {
                        if (event === 'close') setTimeout(() => cb(exitCode), 0);
                    }),
                    kill: vi.fn(),
                };
                return mockChild as any;
            });

            // Options say continue, but per-event says fail-fast
            const results = await executeHooksForEvent('issue-created', mockPayload, {
                onFailure: 'continue',
            });

            // Per-event override should take precedence - should stop after first
            expect(results).toHaveLength(1);
            expect(results[0].aborted).toBe(true);
        });
    });

    describe('fire-and-forget hooks', () => {
        it('should never abort for fire-and-forget hooks', async () => {
            const hooks: EventHook[] = [
                { name: 'hook1', event: 'issue-created', command: 'exit 1', enabled: true, mode: 'fire-and-forget' },
                { name: 'hook2', event: 'issue-created', command: 'exit 0', enabled: true, mode: 'fire-and-forget' },
            ];

            vi.mocked(getHooksForEvent).mockReturnValue(hooks);

            let callCount = 0;
            vi.mocked(spawn).mockImplementation(() => {
                callCount++;
                const exitCode = callCount === 1 ? 1 : 0;
                const mockChild = {
                    stdout: { on: vi.fn() },
                    stderr: { on: vi.fn() },
                    stdin: { write: vi.fn(), end: vi.fn() },
                    on: vi.fn((event, cb) => {
                        if (event === 'close') setTimeout(() => cb(exitCode), 0);
                    }),
                    kill: vi.fn(),
                };
                return mockChild as any;
            });

            // Even with fail-fast, fire-and-forget hooks don't abort
            const results = await executeHooksForEvent('issue-created', mockPayload, {
                onFailure: 'fail-fast',
            });

            // Both hooks should run because fire-and-forget never sets aborted=true
            expect(results).toHaveLength(2);
            expect(results[0].aborted).toBe(false);
            expect(results[1].aborted).toBe(false);
        });
    });
});

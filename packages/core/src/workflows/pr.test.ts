/**
 * Tests for PR workflows
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RepoInfo } from '../types.js';

// Mock git-utils
vi.mock('../git-utils.js', () => ({
    getCurrentBranch: vi.fn(),
}));

// Mock hook executor
vi.mock('../plugins/executor.js', () => ({
    executeHooksForEvent: vi.fn(),
    hasHooksForEvent: vi.fn(),
    shouldAbort: vi.fn().mockReturnValue(false),
}));

// Mock dashboard (for pre-pr hook payload)
vi.mock('../dashboard/index.js', () => ({
    getDiffStats: vi.fn().mockResolvedValue({
        filesChanged: 3,
        insertions: 100,
        deletions: 50,
        files: [],
    }),
    getChangedFiles: vi.fn().mockResolvedValue([
        { path: 'src/file1.ts', status: 'modified' },
        { path: 'src/file2.ts', status: 'added' },
    ]),
}));

// Create a mock for execAsync that we can control
const mockExecAsync = vi.fn();

// Mock child_process.exec and util.promisify at module level
vi.mock('child_process', () => ({
    exec: vi.fn(),
}));

vi.mock('util', () => ({
    promisify: () => mockExecAsync,
}));

import { getCurrentBranch } from '../git-utils.js';
import { executeHooksForEvent, hasHooksForEvent, shouldAbort } from '../plugins/executor.js';

// Import after mocks are set up
const { createPRWorkflow } = await import('./pr.js');

const mockRepo: RepoInfo = {
    owner: 'testowner',
    name: 'testrepo',
    fullName: 'testowner/testrepo',
};

describe('createPRWorkflow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should create a PR and fire hooks', async () => {
        vi.mocked(getCurrentBranch).mockResolvedValue('feature/test-branch');
        mockExecAsync.mockResolvedValue({
            stdout: 'https://github.com/testowner/testrepo/pull/42\n',
            stderr: '',
        });
        vi.mocked(hasHooksForEvent).mockReturnValue(true);
        vi.mocked(shouldAbort).mockReturnValue(false);
        vi.mocked(executeHooksForEvent).mockResolvedValue([
            { hookName: 'test-hook', success: true },
        ]);

        const result = await createPRWorkflow({
            repo: mockRepo,
            title: 'Add new feature',
            body: 'This PR adds a new feature',
        });

        expect(result.success).toBe(true);
        expect(result.pr?.number).toBe(42);
        expect(result.pr?.url).toBe('https://github.com/testowner/testrepo/pull/42');
        // Now fires 3 hook events: pre-pr, pr-creating, pr-created
        expect(result.hookResults).toHaveLength(3);

        // Verify pre-pr hooks were called with diff stats
        expect(executeHooksForEvent).toHaveBeenCalledWith(
            'pre-pr',
            expect.objectContaining({
                repo: 'testowner/testrepo',
                branch: 'feature/test-branch',
                base: 'main',
                changed_files: expect.any(Array),
                diff_stat: expect.objectContaining({
                    additions: 100,
                    deletions: 50,
                    files_changed: 3,
                }),
            }),
            expect.objectContaining({})
        );

        // Verify pr-creating hooks were called with title/body
        expect(executeHooksForEvent).toHaveBeenCalledWith(
            'pr-creating',
            expect.objectContaining({
                repo: 'testowner/testrepo',
                title: 'Add new feature',
                body: 'This PR adds a new feature',
            }),
            expect.objectContaining({})
        );

        // Verify pr-created hooks were called
        expect(executeHooksForEvent).toHaveBeenCalledWith(
            'pr-created',
            expect.objectContaining({
                repo: 'testowner/testrepo',
                pr: expect.objectContaining({
                    number: 42,
                    title: 'Add new feature',
                }),
                branch: 'feature/test-branch',
            }),
            expect.objectContaining({})
        );
    });

    it('should include issue reference when linked', async () => {
        vi.mocked(getCurrentBranch).mockResolvedValue('testuser/123-feature');
        mockExecAsync.mockResolvedValue({
            stdout: 'https://github.com/testowner/testrepo/pull/50\n',
            stderr: '',
        });
        vi.mocked(hasHooksForEvent).mockReturnValue(true);
        vi.mocked(shouldAbort).mockReturnValue(false);
        vi.mocked(executeHooksForEvent).mockResolvedValue([]);

        const result = await createPRWorkflow({
            repo: mockRepo,
            title: 'Fix issue #123',
            issueNumber: 123,
        });

        expect(result.success).toBe(true);
        expect(result.issue?.number).toBe(123);
        expect(result.pr?.body).toContain('Relates to #123');

        expect(executeHooksForEvent).toHaveBeenCalledWith(
            'pr-created',
            expect.objectContaining({
                issue: expect.objectContaining({
                    number: 123,
                }),
            }),
            expect.objectContaining({})
        );
    });

    it('should handle PR already exists error', async () => {
        vi.mocked(getCurrentBranch).mockResolvedValue('existing-branch');
        // No hooks for this test - we want to test the error handling
        vi.mocked(hasHooksForEvent).mockReturnValue(false);
        mockExecAsync.mockRejectedValue({
            stderr: 'a pull request already exists for this branch',
        });

        const result = await createPRWorkflow({
            repo: mockRepo,
            title: 'Duplicate PR',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('already exists');
    });

    it('should handle missing current branch', async () => {
        vi.mocked(getCurrentBranch).mockResolvedValue(null);

        const result = await createPRWorkflow({
            repo: mockRepo,
            title: 'No branch',
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Could not determine current branch');
    });

    it('should use provided head branch instead of current', async () => {
        mockExecAsync.mockImplementation((cmd: string) => {
            expect(cmd).toContain('--head custom-branch');
            return Promise.resolve({
                stdout: 'https://github.com/testowner/testrepo/pull/55\n',
                stderr: '',
            });
        });
        vi.mocked(hasHooksForEvent).mockReturnValue(false);

        const result = await createPRWorkflow({
            repo: mockRepo,
            title: 'From custom branch',
            headBranch: 'custom-branch',
        });

        expect(result.success).toBe(true);
        expect(getCurrentBranch).not.toHaveBeenCalled();
    });

    it('should not fire hooks when none registered', async () => {
        vi.mocked(getCurrentBranch).mockResolvedValue('test-branch');
        mockExecAsync.mockResolvedValue({
            stdout: 'https://github.com/testowner/testrepo/pull/60\n',
            stderr: '',
        });
        vi.mocked(hasHooksForEvent).mockReturnValue(false);

        const result = await createPRWorkflow({
            repo: mockRepo,
            title: 'No hooks',
        });

        expect(result.success).toBe(true);
        expect(result.hookResults).toHaveLength(0);
        expect(executeHooksForEvent).not.toHaveBeenCalled();
    });

    it('should abort when pre-pr hook signals abort', async () => {
        vi.mocked(getCurrentBranch).mockResolvedValue('test-branch');
        vi.mocked(hasHooksForEvent).mockImplementation((event) => event === 'pre-pr');
        vi.mocked(executeHooksForEvent).mockResolvedValue([
            { hookName: 'lint-check', success: false, aborted: true },
        ]);
        vi.mocked(shouldAbort).mockReturnValue(true);

        const result = await createPRWorkflow({
            repo: mockRepo,
            title: 'Will be aborted',
        });

        expect(result.success).toBe(false);
        expect(result.abortedByHook).toBe('lint-check');
        expect(result.abortedAtEvent).toBe('pre-pr');
        expect(mockExecAsync).not.toHaveBeenCalled(); // PR should not be created
    });

    it('should continue with --force even when hook signals abort', async () => {
        vi.mocked(getCurrentBranch).mockResolvedValue('test-branch');
        mockExecAsync.mockResolvedValue({
            stdout: 'https://github.com/testowner/testrepo/pull/70\n',
            stderr: '',
        });
        vi.mocked(hasHooksForEvent).mockImplementation((event) => event === 'pre-pr');
        vi.mocked(executeHooksForEvent).mockResolvedValue([
            { hookName: 'lint-check', success: false, aborted: true },
        ]);
        vi.mocked(shouldAbort).mockReturnValue(true);

        const result = await createPRWorkflow({
            repo: mockRepo,
            title: 'Forced through',
            force: true,
        });

        expect(result.success).toBe(true);
        expect(result.pr?.number).toBe(70);
        expect(result.abortedByHook).toBeUndefined();
    });

    it('should skip all hooks with skipHooks option', async () => {
        vi.mocked(getCurrentBranch).mockResolvedValue('test-branch');
        mockExecAsync.mockResolvedValue({
            stdout: 'https://github.com/testowner/testrepo/pull/80\n',
            stderr: '',
        });

        const result = await createPRWorkflow({
            repo: mockRepo,
            title: 'Skip hooks',
            skipHooks: true,
        });

        expect(result.success).toBe(true);
        expect(result.hookResults).toHaveLength(0);
        expect(hasHooksForEvent).not.toHaveBeenCalled();
        expect(executeHooksForEvent).not.toHaveBeenCalled();
    });
});

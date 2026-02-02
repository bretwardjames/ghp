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
import { executeHooksForEvent, hasHooksForEvent } from '../plugins/executor.js';

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
        vi.mocked(executeHooksForEvent).mockResolvedValue([
            { hookName: 'pr-notify', success: true },
        ]);

        const result = await createPRWorkflow({
            repo: mockRepo,
            title: 'Add new feature',
            body: 'This PR adds a new feature',
        });

        expect(result.success).toBe(true);
        expect(result.pr?.number).toBe(42);
        expect(result.pr?.url).toBe('https://github.com/testowner/testrepo/pull/42');
        expect(result.hookResults).toHaveLength(1);

        expect(executeHooksForEvent).toHaveBeenCalledWith(
            'pr-created',
            expect.objectContaining({
                repo: 'testowner/testrepo',
                pr: expect.objectContaining({
                    number: 42,
                    title: 'Add new feature',
                }),
                branch: 'feature/test-branch',
            })
        );
    });

    it('should include issue reference when linked', async () => {
        vi.mocked(getCurrentBranch).mockResolvedValue('testuser/123-feature');
        mockExecAsync.mockResolvedValue({
            stdout: 'https://github.com/testowner/testrepo/pull/50\n',
            stderr: '',
        });
        vi.mocked(hasHooksForEvent).mockReturnValue(true);
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
            })
        );
    });

    it('should handle PR already exists error', async () => {
        vi.mocked(getCurrentBranch).mockResolvedValue('existing-branch');
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
});

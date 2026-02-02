/**
 * Tests for worktree workflows
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWorktreeWorkflow, removeWorktreeWorkflow } from './worktree.js';
import type { RepoInfo } from '../types.js';
import { GitError } from '../types.js';

// Mock git-utils, but preserve the real GitError class for instanceof checks
vi.mock('../git-utils.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../git-utils.js')>();
    return {
        ...actual,
        createWorktree: vi.fn(),
        removeWorktree: vi.fn(),
        listWorktrees: vi.fn(),
        // Preserve the real GitError for instanceof checks
        GitError: actual.GitError,
    };
});

// Mock hook executor
vi.mock('../plugins/executor.js', () => ({
    executeHooksForEvent: vi.fn(),
    hasHooksForEvent: vi.fn(),
}));

import { createWorktree, removeWorktree, listWorktrees, GitError as GitErrorFromUtils } from '../git-utils.js';
import { executeHooksForEvent, hasHooksForEvent } from '../plugins/executor.js';

const mockRepo: RepoInfo = {
    owner: 'testowner',
    name: 'testrepo',
    fullName: 'testowner/testrepo',
};

describe('createWorktreeWorkflow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should create a worktree and fire hooks', async () => {
        vi.mocked(listWorktrees).mockResolvedValue([]);
        vi.mocked(createWorktree).mockResolvedValue(undefined);
        vi.mocked(hasHooksForEvent).mockReturnValue(true);
        vi.mocked(executeHooksForEvent).mockResolvedValue([
            { hookName: 'test-hook', success: true },
        ]);

        const result = await createWorktreeWorkflow({
            repo: mockRepo,
            issueNumber: 123,
            issueTitle: 'Test Issue',
            branch: 'testowner/123-test-issue',
            path: '/tmp/worktrees/testrepo/123-test-issue',
        });

        expect(result.success).toBe(true);
        expect(result.worktree?.path).toBe('/tmp/worktrees/testrepo/123-test-issue');
        expect(result.worktree?.name).toBe('123-test-issue');
        expect(result.alreadyExisted).toBe(false);
        expect(result.hookResults).toHaveLength(1);
        expect(result.hookResults[0].hookName).toBe('test-hook');

        // Verify hook was called with correct cwd
        expect(executeHooksForEvent).toHaveBeenCalledWith(
            'worktree-created',
            expect.objectContaining({
                repo: 'testowner/testrepo',
                branch: 'testowner/123-test-issue',
                worktree: {
                    path: '/tmp/worktrees/testrepo/123-test-issue',
                    name: '123-test-issue',
                },
                issue: {
                    number: 123,
                    title: 'Test Issue',
                    url: 'https://github.com/testowner/testrepo/issues/123',
                },
            }),
            expect.objectContaining({ cwd: '/tmp/worktrees/testrepo/123-test-issue' })
        );
    });

    it('should return existing worktree without creating', async () => {
        vi.mocked(listWorktrees).mockResolvedValue([
            {
                path: '/existing/worktree/path',
                branch: 'testowner/123-test-issue',
                isMain: false,
            },
        ]);

        const result = await createWorktreeWorkflow({
            repo: mockRepo,
            issueNumber: 123,
            issueTitle: 'Test Issue',
            branch: 'testowner/123-test-issue',
            path: '/tmp/worktrees/testrepo/123-test-issue',
        });

        expect(result.success).toBe(true);
        expect(result.alreadyExisted).toBe(true);
        expect(result.hookResults).toHaveLength(0);
        expect(createWorktree).not.toHaveBeenCalled();
    });

    it('should not fire hooks when none are registered', async () => {
        vi.mocked(listWorktrees).mockResolvedValue([]);
        vi.mocked(createWorktree).mockResolvedValue(undefined);
        vi.mocked(hasHooksForEvent).mockReturnValue(false);

        const result = await createWorktreeWorkflow({
            repo: mockRepo,
            issueNumber: 123,
            issueTitle: 'Test Issue',
            branch: 'testowner/123-test-issue',
            path: '/tmp/worktrees/testrepo/123-test-issue',
        });

        expect(result.success).toBe(true);
        expect(result.hookResults).toHaveLength(0);
        expect(executeHooksForEvent).not.toHaveBeenCalled();
    });

    it('should handle git errors gracefully', async () => {
        vi.mocked(listWorktrees).mockResolvedValue([]);
        vi.mocked(createWorktree).mockRejectedValue(new Error('Git error'));

        const result = await createWorktreeWorkflow({
            repo: mockRepo,
            issueNumber: 123,
            issueTitle: 'Test Issue',
            branch: 'testowner/123-test-issue',
            path: '/tmp/worktrees/testrepo/123-test-issue',
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Git error');
    });

    it('should include stderr in error message when GitError is thrown', async () => {
        vi.mocked(listWorktrees).mockResolvedValue([]);

        // Use the GitError from git-utils (same class workflow checks instanceof against)
        const gitError = new GitErrorFromUtils({
            message: 'fatal: branch already exists',
            command: 'git worktree add /path branch',
            stderr: "fatal: 'branch' is already checked out at '/other/path'",
            exitCode: 128,
            cwd: '/repo',
        });
        vi.mocked(createWorktree).mockRejectedValue(gitError);

        const result = await createWorktreeWorkflow({
            repo: mockRepo,
            issueNumber: 123,
            issueTitle: 'Test Issue',
            branch: 'testowner/123-test-issue',
            path: '/tmp/worktrees/testrepo/123-test-issue',
        });

        expect(result.success).toBe(false);
        // Error should include both message and stderr
        expect(result.error).toContain('fatal: branch already exists');
        expect(result.error).toContain("'branch' is already checked out");
    });
});

describe('removeWorktreeWorkflow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should remove worktree by branch and fire hooks', async () => {
        vi.mocked(listWorktrees).mockResolvedValue([
            {
                path: '/worktrees/testrepo/123-test',
                branch: 'testowner/123-test',
                isMain: false,
            },
        ]);
        vi.mocked(removeWorktree).mockResolvedValue(undefined);
        vi.mocked(hasHooksForEvent).mockReturnValue(true);
        vi.mocked(executeHooksForEvent).mockResolvedValue([
            { hookName: 'cleanup-hook', success: true },
        ]);

        const result = await removeWorktreeWorkflow({
            repo: mockRepo,
            issueNumber: 123,
            issueTitle: 'Test Issue',
            branch: 'testowner/123-test',
        });

        expect(result.success).toBe(true);
        expect(result.worktree?.path).toBe('/worktrees/testrepo/123-test');
        expect(result.hookResults).toHaveLength(1);

        expect(executeHooksForEvent).toHaveBeenCalledWith(
            'worktree-removed',
            expect.objectContaining({
                repo: 'testowner/testrepo',
                branch: 'testowner/123-test',
            }),
            expect.objectContaining({})
        );
    });

    it('should find worktree by issue number in branch name', async () => {
        vi.mocked(listWorktrees).mockResolvedValue([
            {
                path: '/worktrees/testrepo/456-other',
                branch: 'user/456-other-feature',
                isMain: false,
            },
            {
                path: '/worktrees/testrepo/123-test',
                branch: 'user/123-test-feature',
                isMain: false,
            },
        ]);
        vi.mocked(removeWorktree).mockResolvedValue(undefined);
        vi.mocked(hasHooksForEvent).mockReturnValue(false);

        const result = await removeWorktreeWorkflow({
            repo: mockRepo,
            issueNumber: 123,
        });

        expect(result.success).toBe(true);
        expect(result.worktree?.path).toBe('/worktrees/testrepo/123-test');
    });

    it('should return error when worktree not found', async () => {
        vi.mocked(listWorktrees).mockResolvedValue([]);

        const result = await removeWorktreeWorkflow({
            repo: mockRepo,
            issueNumber: 999,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('No worktree found');
    });

    it('should handle removal errors', async () => {
        vi.mocked(listWorktrees).mockResolvedValue([
            {
                path: '/worktrees/testrepo/123-test',
                branch: 'user/123-test',
                isMain: false,
            },
        ]);
        vi.mocked(removeWorktree).mockRejectedValue(new Error('Uncommitted changes'));

        const result = await removeWorktreeWorkflow({
            repo: mockRepo,
            issueNumber: 123,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Uncommitted changes');
    });

    it('should include stderr in error message when GitError is thrown during removal', async () => {
        vi.mocked(listWorktrees).mockResolvedValue([
            {
                path: '/worktrees/testrepo/123-test',
                branch: 'user/123-test',
                isMain: false,
            },
        ]);

        // Use the GitError from git-utils (same class workflow checks instanceof against)
        const gitError = new GitErrorFromUtils({
            message: 'Worktree contains uncommitted changes',
            command: 'git worktree remove /path',
            stderr: "error: '/worktrees/testrepo/123-test' contains modified or untracked files",
            exitCode: 1,
            cwd: '/repo',
        });
        vi.mocked(removeWorktree).mockRejectedValue(gitError);

        const result = await removeWorktreeWorkflow({
            repo: mockRepo,
            issueNumber: 123,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Worktree contains uncommitted changes');
        expect(result.error).toContain('modified or untracked files');
    });
});

/**
 * Tests for issue workflows
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createIssueWorkflow, startIssueWorkflow } from './issue.js';
import type { RepoInfo } from '../types.js';
import type { GitHubAPI } from '../github-api.js';

// Mock git-utils
vi.mock('../git-utils.js', () => ({
    createBranch: vi.fn(),
    checkoutBranch: vi.fn(),
    branchExists: vi.fn(),
    generateBranchName: vi.fn(),
    getCurrentBranch: vi.fn(),
}));

// Mock hook executor
vi.mock('../plugins/executor.js', () => ({
    executeHooksForEvent: vi.fn(),
    hasHooksForEvent: vi.fn(),
}));

// Mock worktree workflow
vi.mock('./worktree.js', () => ({
    createWorktreeWorkflow: vi.fn(),
}));

import { createBranch, checkoutBranch, branchExists, generateBranchName } from '../git-utils.js';
import { executeHooksForEvent, hasHooksForEvent } from '../plugins/executor.js';
import { createWorktreeWorkflow } from './worktree.js';

const mockRepo: RepoInfo = {
    owner: 'testowner',
    name: 'testrepo',
    fullName: 'testowner/testrepo',
};

// Create a mock API object
function createMockApi(): Partial<GitHubAPI> {
    return {
        createIssue: vi.fn(),
        addToProject: vi.fn(),
        getStatusField: vi.fn(),
        updateItemStatus: vi.fn(),
        addLabelToIssue: vi.fn(),
        updateAssignees: vi.fn(),
        addSubIssue: vi.fn(),
        findItemByNumber: vi.fn(),
    };
}

describe('createIssueWorkflow', () => {
    let mockApi: ReturnType<typeof createMockApi>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockApi = createMockApi();
    });

    it('should create an issue and fire hooks', async () => {
        vi.mocked(mockApi.createIssue).mockResolvedValue({ number: 123, id: 'issue-id' });
        vi.mocked(mockApi.addToProject).mockResolvedValue('item-id');
        vi.mocked(hasHooksForEvent).mockReturnValue(true);
        vi.mocked(executeHooksForEvent).mockResolvedValue([
            { hookName: 'notify-hook', success: true },
        ]);

        const result = await createIssueWorkflow(mockApi as GitHubAPI, {
            repo: mockRepo,
            title: 'Test Issue',
            body: 'Issue body',
            projectId: 'project-123',
        });

        expect(result.success).toBe(true);
        expect(result.issue?.number).toBe(123);
        expect(result.issue?.title).toBe('Test Issue');
        expect(result.projectItemId).toBe('item-id');
        expect(result.hookResults).toHaveLength(1);

        expect(executeHooksForEvent).toHaveBeenCalledWith(
            'issue-created',
            expect.objectContaining({
                repo: 'testowner/testrepo',
                issue: expect.objectContaining({
                    number: 123,
                    title: 'Test Issue',
                    body: 'Issue body',
                }),
            })
        );
    });

    it('should set initial status when provided', async () => {
        vi.mocked(mockApi.createIssue).mockResolvedValue({ number: 123, id: 'issue-id' });
        vi.mocked(mockApi.addToProject).mockResolvedValue('item-id');
        vi.mocked(mockApi.getStatusField).mockResolvedValue({
            fieldId: 'field-123',
            options: [
                { id: 'opt-1', name: 'Todo' },
                { id: 'opt-2', name: 'In Progress' },
            ],
        });
        vi.mocked(mockApi.updateItemStatus).mockResolvedValue(true);
        vi.mocked(hasHooksForEvent).mockReturnValue(false);

        const result = await createIssueWorkflow(mockApi as GitHubAPI, {
            repo: mockRepo,
            title: 'Test Issue',
            projectId: 'project-123',
            status: 'In Progress',
        });

        expect(result.success).toBe(true);
        expect(mockApi.updateItemStatus).toHaveBeenCalledWith(
            'project-123',
            'item-id',
            'field-123',
            'opt-2'
        );
    });

    it('should apply labels when provided', async () => {
        vi.mocked(mockApi.createIssue).mockResolvedValue({ number: 123, id: 'issue-id' });
        vi.mocked(mockApi.addToProject).mockResolvedValue('item-id');
        vi.mocked(mockApi.addLabelToIssue).mockResolvedValue(true);
        vi.mocked(hasHooksForEvent).mockReturnValue(false);

        const result = await createIssueWorkflow(mockApi as GitHubAPI, {
            repo: mockRepo,
            title: 'Test Issue',
            projectId: 'project-123',
            labels: ['bug', 'high-priority'],
        });

        expect(result.success).toBe(true);
        expect(mockApi.addLabelToIssue).toHaveBeenCalledTimes(2);
        expect(mockApi.addLabelToIssue).toHaveBeenCalledWith(mockRepo, 123, 'bug');
        expect(mockApi.addLabelToIssue).toHaveBeenCalledWith(mockRepo, 123, 'high-priority');
    });

    it('should link to parent issue when provided', async () => {
        vi.mocked(mockApi.createIssue).mockResolvedValue({ number: 123, id: 'issue-id' });
        vi.mocked(mockApi.addToProject).mockResolvedValue('item-id');
        vi.mocked(mockApi.addSubIssue).mockResolvedValue(true);
        vi.mocked(hasHooksForEvent).mockReturnValue(false);

        const result = await createIssueWorkflow(mockApi as GitHubAPI, {
            repo: mockRepo,
            title: 'Sub-issue',
            projectId: 'project-123',
            parentIssueNumber: 100,
        });

        expect(result.success).toBe(true);
        expect(mockApi.addSubIssue).toHaveBeenCalledWith(mockRepo, 100, 123);
    });

    it('should handle API errors gracefully', async () => {
        vi.mocked(mockApi.createIssue).mockResolvedValue(null);

        const result = await createIssueWorkflow(mockApi as GitHubAPI, {
            repo: mockRepo,
            title: 'Test Issue',
            projectId: 'project-123',
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Failed to create issue');
    });
});

describe('startIssueWorkflow', () => {
    let mockApi: ReturnType<typeof createMockApi>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockApi = createMockApi();
    });

    it('should create branch and fire hooks in normal mode', async () => {
        vi.mocked(branchExists).mockResolvedValue(false);
        vi.mocked(createBranch).mockResolvedValue(undefined);
        vi.mocked(checkoutBranch).mockResolvedValue(undefined);
        vi.mocked(generateBranchName).mockReturnValue('testuser/123-test-issue');
        vi.mocked(hasHooksForEvent).mockReturnValue(true);
        vi.mocked(executeHooksForEvent).mockResolvedValue([
            { hookName: 'setup-hook', success: true },
        ]);

        const result = await startIssueWorkflow(mockApi as GitHubAPI, {
            repo: mockRepo,
            issueNumber: 123,
            issueTitle: 'Test Issue',
            branchPattern: '{user}/{number}-{title}',
            username: 'testuser',
        });

        expect(result.success).toBe(true);
        expect(result.branch).toBe('testuser/123-test-issue');
        expect(result.branchCreated).toBe(true);
        expect(result.hookResults).toHaveLength(1);

        expect(executeHooksForEvent).toHaveBeenCalledWith(
            'issue-started',
            expect.objectContaining({
                repo: 'testowner/testrepo',
                issue: expect.objectContaining({
                    number: 123,
                    title: 'Test Issue',
                }),
                branch: 'testuser/123-test-issue',
            }),
            { cwd: undefined }
        );
    });

    it('should use linked branch when provided', async () => {
        vi.mocked(checkoutBranch).mockResolvedValue(undefined);
        vi.mocked(hasHooksForEvent).mockReturnValue(false);

        const result = await startIssueWorkflow(mockApi as GitHubAPI, {
            repo: mockRepo,
            issueNumber: 123,
            issueTitle: 'Test Issue',
            linkedBranch: 'existing-branch',
        });

        expect(result.success).toBe(true);
        expect(result.branch).toBe('existing-branch');
        expect(result.branchCreated).toBe(false);
        expect(generateBranchName).not.toHaveBeenCalled();
    });

    it('should create worktree in parallel mode and fire hooks from inside', async () => {
        vi.mocked(branchExists).mockResolvedValue(false);
        vi.mocked(createBranch).mockResolvedValue(undefined);
        vi.mocked(generateBranchName).mockReturnValue('testuser/123-test-issue');
        vi.mocked(createWorktreeWorkflow).mockResolvedValue({
            success: true,
            worktree: {
                path: '/worktrees/testrepo/123-test-issue',
                name: '123-test-issue',
            },
            alreadyExisted: false,
            branch: 'testuser/123-test-issue',
            hookResults: [{ hookName: 'worktree-hook', success: true }],
        });
        vi.mocked(hasHooksForEvent).mockReturnValue(true);
        vi.mocked(executeHooksForEvent).mockResolvedValue([
            { hookName: 'issue-hook', success: true },
        ]);

        const result = await startIssueWorkflow(mockApi as GitHubAPI, {
            repo: mockRepo,
            issueNumber: 123,
            issueTitle: 'Test Issue',
            parallel: true,
            worktreePath: '/worktrees/testrepo/123-test-issue',
            branchPattern: '{user}/{number}-{title}',
            username: 'testuser',
        });

        expect(result.success).toBe(true);
        expect(result.worktree?.path).toBe('/worktrees/testrepo/123-test-issue');
        expect(result.worktreeCreated).toBe(true);

        // Should have hooks from both worktree and issue-started
        expect(result.hookResults).toHaveLength(2);
        expect(result.hookResults[0].hookName).toBe('worktree-hook');
        expect(result.hookResults[1].hookName).toBe('issue-hook');

        // issue-started hook should fire from inside the worktree
        expect(executeHooksForEvent).toHaveBeenCalledWith(
            'issue-started',
            expect.any(Object),
            { cwd: '/worktrees/testrepo/123-test-issue' }
        );
    });

    it('should require worktreePath in parallel mode', async () => {
        vi.mocked(branchExists).mockResolvedValue(false);
        vi.mocked(createBranch).mockResolvedValue(undefined);
        vi.mocked(generateBranchName).mockReturnValue('testuser/123-test-issue');

        const result = await startIssueWorkflow(mockApi as GitHubAPI, {
            repo: mockRepo,
            issueNumber: 123,
            issueTitle: 'Test Issue',
            parallel: true,
            // worktreePath missing
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('worktreePath is required');
    });

    it('should skip hooks in review mode', async () => {
        vi.mocked(checkoutBranch).mockResolvedValue(undefined);
        vi.mocked(hasHooksForEvent).mockReturnValue(true);

        const result = await startIssueWorkflow(mockApi as GitHubAPI, {
            repo: mockRepo,
            issueNumber: 123,
            issueTitle: 'Test Issue',
            linkedBranch: 'existing-branch',
            review: true,
        });

        expect(result.success).toBe(true);
        expect(executeHooksForEvent).not.toHaveBeenCalled();
    });
});

/**
 * Tests for the start command
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process
vi.mock('child_process', () => ({
    exec: vi.fn(),
    spawn: vi.fn(),
}));
vi.mock('util', async () => {
    const actual = await vi.importActual<typeof import('util')>('util');
    return {
        ...actual,
        promisify: vi.fn(() => vi.fn()),
    };
});

// Mock GitHub API - define inline since vi.mock is hoisted
vi.mock('../github-api.js', () => ({
    api: {
        authenticate: vi.fn(),
        username: 'testuser',
        findItemByNumber: vi.fn(),
        getIssueDetails: vi.fn(),
        getProjects: vi.fn(),
        addIssueToProject: vi.fn(),
        getStatusField: vi.fn(),
        updateItemStatus: vi.fn(),
        updateAssignees: vi.fn(),
    },
}));

// Mock git-utils
vi.mock('../git-utils.js', () => ({
    detectRepository: vi.fn(),
    getCurrentBranch: vi.fn(),
    hasUncommittedChanges: vi.fn(),
    branchExists: vi.fn(),
    createBranch: vi.fn(),
    checkoutBranch: vi.fn(),
    getCommitsBehind: vi.fn(),
    pullLatest: vi.fn(),
    generateBranchName: vi.fn(),
    getAllBranches: vi.fn(),
    getWorktreeForBranch: vi.fn(),
}));

// Mock config
vi.mock('../config.js', () => ({
    getConfig: vi.fn(),
    getParallelWorkConfig: vi.fn(() => ({ openTerminal: false })),
}));

// Mock branch-linker
vi.mock('../branch-linker.js', () => ({
    linkBranch: vi.fn(),
    getBranchForIssue: vi.fn(),
}));

// Mock prompts
vi.mock('../prompts.js', () => ({
    confirmWithDefault: vi.fn(),
    promptSelectWithDefault: vi.fn(),
    isInteractive: vi.fn(() => false),
}));

// Mock active-label
vi.mock('../active-label.js', () => ({
    applyActiveLabel: vi.fn(),
}));

// Mock worktree-utils
vi.mock('../worktree-utils.js', () => ({
    createParallelWorktree: vi.fn(),
    getBranchWorktree: vi.fn(),
}));

// Mock terminal-utils
vi.mock('../terminal-utils.js', () => ({
    openParallelWorkTerminal: vi.fn(),
    openAdminPane: vi.fn(),
    isInsideTmux: vi.fn(() => false),
}));

// Mock @bretwardjames/ghp-core
vi.mock('@bretwardjames/ghp-core', () => ({
    registerAgent: vi.fn(() => ({ id: 'agent-123' })),
    updateAgent: vi.fn(),
    extractIssueNumberFromBranch: vi.fn(),
    getAgentByIssue: vi.fn(),
    executeHooksForEvent: vi.fn(),
    hasHooksForEvent: vi.fn(() => false),
}));

// Import mocked functions for test setup
import { detectRepository, getCurrentBranch, hasUncommittedChanges, branchExists, checkoutBranch } from '../git-utils.js';
import { getBranchForIssue, linkBranch } from '../branch-linker.js';
import { getConfig } from '../config.js';
import { applyActiveLabel } from '../active-label.js';
import { confirmWithDefault, promptSelectWithDefault } from '../prompts.js';
import { api } from '../github-api.js';

// Import after mocks are set up
import { startCommand } from './start.js';

// Mock process.exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit called');
});

// Mock console methods
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

describe('startCommand', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Default mock implementations
        vi.mocked(detectRepository).mockResolvedValue({
            owner: 'testowner',
            name: 'testrepo',
            fullName: 'testowner/testrepo',
        });
        vi.mocked(api.authenticate).mockResolvedValue(true);
    });

    describe('input validation', () => {
        it('should reject non-numeric issue input', async () => {
            await expect(startCommand('invalid', {})).rejects.toThrow('process.exit called');
            expect(mockConsoleError).toHaveBeenCalledWith(
                expect.anything(),
                'Input must be a number'
            );
        });

        it('should require being in a git repository', async () => {
            vi.mocked(detectRepository).mockResolvedValue(null);

            await expect(startCommand('123', {})).rejects.toThrow('process.exit called');
            expect(mockConsoleError).toHaveBeenCalledWith(
                expect.anything(),
                'Not in a git repository with a GitHub remote'
            );
        });

        it('should require authentication', async () => {
            vi.mocked(api.authenticate).mockResolvedValue(false);

            await expect(startCommand('123', {})).rejects.toThrow('process.exit called');
            // Error is split across multiple arguments: "Error:", "Not authenticated. Run", "ghp auth"
            expect(mockConsoleError).toHaveBeenCalledWith(
                expect.anything(),
                'Not authenticated. Run',
                expect.anything()
            );
        });
    });

    describe('issue lookup', () => {
        it('should fail when issue does not exist', async () => {
            vi.mocked(api.findItemByNumber).mockResolvedValue(null);
            vi.mocked(api.getIssueDetails).mockResolvedValue(null);

            await expect(startCommand('123', {})).rejects.toThrow('process.exit called');
            expect(mockConsoleError).toHaveBeenCalledWith(
                expect.anything(),
                'Issue #123 does not exist'
            );
        });

        it('should find issue in project', async () => {
            vi.mocked(api.findItemByNumber).mockResolvedValue({
                id: 'item-123',
                title: 'Test Issue',
                number: 123,
                status: 'Todo',
                projectId: 'proj-1',
                projectTitle: 'Test Project',
                assignees: ['testuser'],
                blockedBy: [],
            } as any);
            vi.mocked(getBranchForIssue).mockResolvedValue(null);
            vi.mocked(hasUncommittedChanges).mockResolvedValue(false);
            vi.mocked(getCurrentBranch).mockResolvedValue('main');
            vi.mocked(getConfig).mockImplementation((key) => {
                if (key === 'mainBranch') return 'main';
                if (key === 'branchPattern') return '{user}/{number}-{title}';
                return undefined;
            });
            vi.mocked(promptSelectWithDefault).mockResolvedValue(2); // Skip branch creation

            await startCommand('123', { branchAction: 'skip' });

            expect(vi.mocked(api.findItemByNumber)).toHaveBeenCalledWith(
                { owner: 'testowner', name: 'testrepo', fullName: 'testowner/testrepo' },
                123
            );
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.anything(),
                'Test Issue'
            );
        });
    });

    describe('linked branch handling', () => {
        const mockItem = {
            id: 'item-123',
            title: 'Test Issue',
            number: 123,
            status: 'Todo',
            projectId: 'proj-1',
            projectTitle: 'Test Project',
            assignees: ['testuser'],
            blockedBy: [],
        } as any;

        beforeEach(() => {
            vi.mocked(api.findItemByNumber).mockResolvedValue(mockItem);
            vi.mocked(getCurrentBranch).mockResolvedValue('main');
            vi.mocked(hasUncommittedChanges).mockResolvedValue(false);
            vi.mocked(getConfig).mockReturnValue(undefined);
        });

        it('should checkout existing linked branch', async () => {
            vi.mocked(getBranchForIssue).mockResolvedValue('testuser/123-test-issue');
            vi.mocked(branchExists).mockResolvedValue(true);
            vi.mocked(promptSelectWithDefault).mockResolvedValue(0); // Switch to branch (default)

            await startCommand('123', { forceDefaults: true });

            expect(checkoutBranch).toHaveBeenCalledWith('testuser/123-test-issue');
        });

        it('should skip checkout when already on linked branch', async () => {
            vi.mocked(getBranchForIssue).mockResolvedValue('testuser/123-test-issue');
            vi.mocked(getCurrentBranch).mockResolvedValue('testuser/123-test-issue');

            await startCommand('123', {});

            expect(checkoutBranch).not.toHaveBeenCalled();
            // Message is formatted as single string with chalk.dim
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining('Already on branch')
            );
        });
    });

    describe('status and label updates', () => {
        const mockItem = {
            id: 'item-123',
            title: 'Test Issue',
            number: 123,
            status: 'Todo',
            projectId: 'proj-1',
            projectTitle: 'Test Project',
            assignees: ['testuser'],
            blockedBy: [],
        } as any;

        beforeEach(() => {
            vi.mocked(api.findItemByNumber).mockResolvedValue(mockItem);
            vi.mocked(getBranchForIssue).mockResolvedValue('testuser/123-test-issue');
            vi.mocked(getCurrentBranch).mockResolvedValue('testuser/123-test-issue');
            vi.mocked(hasUncommittedChanges).mockResolvedValue(false);
        });

        it('should update status when configured', async () => {
            vi.mocked(getConfig).mockImplementation((key) => {
                if (key === 'startWorkingStatus') return 'In Progress';
                return undefined;
            });
            vi.mocked(api.getStatusField).mockResolvedValue({
                fieldId: 'field-1',
                options: [
                    { id: 'opt-1', name: 'Todo' },
                    { id: 'opt-2', name: 'In Progress' },
                ],
            });
            vi.mocked(api.updateItemStatus).mockResolvedValue(true);

            await startCommand('123', {});

            expect(vi.mocked(api.updateItemStatus)).toHaveBeenCalledWith(
                'proj-1',
                'item-123',
                'field-1',
                'opt-2'
            );
        });

        it('should apply active label', async () => {
            vi.mocked(getConfig).mockReturnValue(undefined);

            await startCommand('123', {});

            expect(applyActiveLabel).toHaveBeenCalledWith(
                { owner: 'testowner', name: 'testrepo', fullName: 'testowner/testrepo' },
                123,
                true // exclusive mode (not parallel)
            );
        });

        it('should skip status and label updates in review mode', async () => {
            vi.mocked(getConfig).mockImplementation((key) => {
                if (key === 'startWorkingStatus') return 'In Progress';
                return undefined;
            });

            // review mode with issue: true to treat input as issue number (not PR)
            await startCommand('123', { review: true, issue: true });

            expect(vi.mocked(api.updateItemStatus)).not.toHaveBeenCalled();
            expect(applyActiveLabel).not.toHaveBeenCalled();
        });
    });

    describe('blocked issues', () => {
        it('should warn about blocking issues', async () => {
            const mockItem = {
                id: 'item-123',
                title: 'Test Issue',
                number: 123,
                status: 'Todo',
                projectId: 'proj-1',
                projectTitle: 'Test Project',
                assignees: ['testuser'],
                blockedBy: [
                    { number: 100, title: 'Blocker Issue', state: 'OPEN' },
                ],
            } as any;
            vi.mocked(api.findItemByNumber).mockResolvedValue(mockItem);
            vi.mocked(getBranchForIssue).mockResolvedValue('testuser/123-test-issue');
            vi.mocked(getCurrentBranch).mockResolvedValue('testuser/123-test-issue');
            vi.mocked(getConfig).mockReturnValue(undefined);

            await startCommand('123', { force: true });

            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining('blocked by')
            );
        });

        it('should not warn about closed blockers', async () => {
            const mockItem = {
                id: 'item-123',
                title: 'Test Issue',
                number: 123,
                status: 'Todo',
                projectId: 'proj-1',
                projectTitle: 'Test Project',
                assignees: ['testuser'],
                blockedBy: [
                    { number: 100, title: 'Closed Blocker', state: 'CLOSED' },
                ],
            } as any;
            vi.mocked(api.findItemByNumber).mockResolvedValue(mockItem);
            vi.mocked(getBranchForIssue).mockResolvedValue('testuser/123-test-issue');
            vi.mocked(getCurrentBranch).mockResolvedValue('testuser/123-test-issue');
            vi.mocked(getConfig).mockReturnValue(undefined);

            await startCommand('123', {});

            // Should not see the blocking warning
            const calls = mockConsoleLog.mock.calls.flat().join(' ');
            expect(calls).not.toContain('blocked by');
        });
    });
});

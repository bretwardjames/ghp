/**
 * Tests for the add-issue command
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

// Mock fs
vi.mock('fs', () => ({
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
}));

// Mock GitHub API
vi.mock('../github-api.js', () => ({
    api: {
        authenticate: vi.fn(),
        username: 'testuser',
        createIssue: vi.fn(),
        getProjects: vi.fn(),
        addToProject: vi.fn(),
        getStatusField: vi.fn(),
        updateItemStatus: vi.fn(),
        addLabelToIssue: vi.fn(),
        addSubIssue: vi.fn(),
        getProjectFields: vi.fn(),
        setFieldValue: vi.fn().mockResolvedValue({ success: true }),
    },
}));

// Mock git-utils
vi.mock('../git-utils.js', () => ({
    detectRepository: vi.fn(),
}));

// Mock config
vi.mock('../config.js', () => ({
    getAddIssueDefaults: vi.fn(() => ({})),
    getClaudeConfig: vi.fn(() => ({})),
}));

// Mock prompts
vi.mock('../prompts.js', () => ({
    promptSelectWithDefault: vi.fn(),
    isInteractive: vi.fn(() => false),
}));

// Mock claude-runner
vi.mock('../claude-runner.js', () => ({
    generateWithClaude: vi.fn(),
}));

// Mock ai-feedback
vi.mock('../ai-feedback.js', () => ({
    runFeedbackLoop: vi.fn((opts) => Promise.resolve({ content: opts.initialContent })),
}));

// Mock @bretwardjames/ghp-core
vi.mock('@bretwardjames/ghp-core', () => ({
    ClaudeClient: vi.fn(),
    claudePrompts: {
        EXPAND_ISSUE_PROMPT: 'test prompt',
        buildExpandIssueUserPrompt: vi.fn(() => 'test user prompt'),
    },
    executeHooksForEvent: vi.fn(() => []),
    hasHooksForEvent: vi.fn(() => false),
}));

// Import mocked functions
import { detectRepository } from '../git-utils.js';
import { api } from '../github-api.js';
import { promptSelectWithDefault } from '../prompts.js';
import { getAddIssueDefaults } from '../config.js';
import { generateWithClaude } from '../claude-runner.js';

// Import command after mocks
import { addIssueCommand } from './add-issue.js';

// Mock process.exit - use undefined as never to satisfy TypeScript's 'never' return type
// without throwing an error that would cause unhandled rejections
vi.spyOn(process, 'exit').mockImplementation((() => undefined) as () => never);

// Reset exit state before each test to prevent "process is exiting" errors
import { _resetForTesting as resetExitState } from '../exit.js';

// Mock console
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

describe('addIssueCommand', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetExitState(); // Reset exit state to prevent "process is exiting" errors

        // Default mocks
        vi.mocked(detectRepository).mockResolvedValue({
            owner: 'testowner',
            name: 'testrepo',
            fullName: 'testowner/testrepo',
        });
        vi.mocked(api.authenticate).mockResolvedValue(true);
        vi.mocked(api.getProjects).mockResolvedValue([
            { id: 'proj-1', title: 'Test Project', number: 1 } as any,
        ]);
    });

    describe('input validation', () => {
        it('should require being in a git repository', async () => {
            vi.mocked(detectRepository).mockResolvedValue(null);

            await expect(addIssueCommand('Test Issue', {})).rejects.toThrow('Process exit pending');
            expect(mockConsoleError).toHaveBeenCalledWith(
                expect.anything(),
                'Not in a git repository with a GitHub remote'
            );
        });

        it('should require authentication', async () => {
            vi.mocked(api.authenticate).mockResolvedValue(false);

            await expect(addIssueCommand('Test Issue', {})).rejects.toThrow('Process exit pending');
            expect(mockConsoleError).toHaveBeenCalledWith(
                expect.anything(),
                'Not authenticated. Run',
                expect.anything()
            );
        });

        it('should require at least one project', async () => {
            vi.mocked(api.getProjects).mockResolvedValue([]);

            await expect(addIssueCommand('Test Issue', {})).rejects.toThrow('Process exit pending');
            expect(mockConsoleError).toHaveBeenCalledWith(
                expect.anything(),
                'No GitHub Projects found for this repository'
            );
        });
    });

    describe('issue creation', () => {
        beforeEach(() => {
            vi.mocked(api.createIssue).mockResolvedValue({
                number: 123,
                id: 'issue-123',
            });
            vi.mocked(api.addToProject).mockResolvedValue('item-123');
            vi.mocked(promptSelectWithDefault).mockResolvedValue(0);
        });

        it('should create an issue with title and body', async () => {
            await addIssueCommand('Test Issue', { body: 'Test body', forceDefaults: true });

            expect(api.createIssue).toHaveBeenCalledWith(
                { owner: 'testowner', name: 'testrepo', fullName: 'testowner/testrepo' },
                'Test Issue',
                'Test body'
            );
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.anything(),
                expect.stringContaining('#123')
            );
        });

        it('should add issue to project', async () => {
            await addIssueCommand('Test Issue', { body: 'Test body', forceDefaults: true });

            expect(api.addToProject).toHaveBeenCalledWith('proj-1', 'issue-123');
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.anything(),
                'Test Project'
            );
        });

        it('should set initial status when provided', async () => {
            vi.mocked(api.getStatusField).mockResolvedValue({
                fieldId: 'field-1',
                options: [
                    { id: 'opt-1', name: 'Todo' },
                    { id: 'opt-2', name: 'In Progress' },
                ],
            });
            vi.mocked(api.updateItemStatus).mockResolvedValue(true);

            await addIssueCommand('Test Issue', {
                body: 'Test body',
                status: 'In Progress',
                forceDefaults: true,
            });

            expect(api.updateItemStatus).toHaveBeenCalledWith(
                'proj-1',
                'item-123',
                'field-1',
                'opt-2'
            );
        });
    });

    describe('labels', () => {
        beforeEach(() => {
            vi.mocked(api.createIssue).mockResolvedValue({ number: 123, id: 'issue-123' });
            vi.mocked(api.addToProject).mockResolvedValue('item-123');
            vi.mocked(api.addLabelToIssue).mockResolvedValue(true);
            vi.mocked(promptSelectWithDefault).mockResolvedValue(0);
        });

        it('should apply labels when provided', async () => {
            await addIssueCommand('Test Issue', {
                body: 'Test body',
                labels: 'bug,high-priority',
                forceDefaults: true,
            });

            expect(api.addLabelToIssue).toHaveBeenCalledWith(
                { owner: 'testowner', name: 'testrepo', fullName: 'testowner/testrepo' },
                123,
                'bug'
            );
            expect(api.addLabelToIssue).toHaveBeenCalledWith(
                { owner: 'testowner', name: 'testrepo', fullName: 'testowner/testrepo' },
                123,
                'high-priority'
            );
        });

        it('should apply epic label for epic type', async () => {
            await addIssueCommand('Test Epic', {
                body: 'Epic body',
                objectType: 'epic',
                forceDefaults: true,
            });

            expect(api.addLabelToIssue).toHaveBeenCalledWith(
                expect.anything(),
                123,
                'epic'
            );
        });
    });

    describe('parent linking', () => {
        beforeEach(() => {
            vi.mocked(api.createIssue).mockResolvedValue({ number: 123, id: 'issue-123' });
            vi.mocked(api.addToProject).mockResolvedValue('item-123');
            vi.mocked(api.addSubIssue).mockResolvedValue(true);
            vi.mocked(promptSelectWithDefault).mockResolvedValue(0);
        });

        it('should link to parent issue when specified', async () => {
            await addIssueCommand('Sub Issue', {
                body: 'Sub issue body',
                parent: '100',
                forceDefaults: true,
            });

            expect(api.addSubIssue).toHaveBeenCalledWith(
                { owner: 'testowner', name: 'testrepo', fullName: 'testowner/testrepo' },
                100,
                123
            );
        });

        it('should warn on invalid parent number', async () => {
            await addIssueCommand('Sub Issue', {
                body: 'Sub issue body',
                parent: 'invalid',
                forceDefaults: true,
            });

            expect(api.addSubIssue).not.toHaveBeenCalled();
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.anything(),
                expect.stringContaining('Invalid parent issue number')
            );
        });
    });

    describe('AI expansion', () => {
        beforeEach(() => {
            vi.mocked(api.createIssue).mockResolvedValue({ number: 123, id: 'issue-123' });
            vi.mocked(api.addToProject).mockResolvedValue('item-123');
            vi.mocked(promptSelectWithDefault).mockResolvedValue(0);
        });

        it('should expand issue with AI when --ai flag is set', async () => {
            vi.mocked(generateWithClaude).mockResolvedValue('## Description\n\nExpanded content');

            await addIssueCommand('Add login feature', { ai: true, forceDefaults: true });

            expect(generateWithClaude).toHaveBeenCalledWith(
                expect.objectContaining({
                    contentType: 'issue description',
                })
            );
            expect(api.createIssue).toHaveBeenCalledWith(
                expect.anything(),
                'Add login feature',
                '## Description\n\nExpanded content'
            );
        });

        it('should apply AI-suggested labels', async () => {
            vi.mocked(generateWithClaude).mockResolvedValue(
                JSON.stringify({ body: 'Expanded content', labels: ['enhancement', 'frontend'] })
            );
            vi.mocked(api.addLabelToIssue).mockResolvedValue(true);

            await addIssueCommand('Add login feature', { ai: true, forceDefaults: true });

            expect(api.addLabelToIssue).toHaveBeenCalledWith(
                expect.anything(),
                123,
                'enhancement'
            );
            expect(api.addLabelToIssue).toHaveBeenCalledWith(
                expect.anything(),
                123,
                'frontend'
            );
        });
    });

    describe('list templates', () => {
        it('should list templates with --list-templates flag', async () => {
            await addIssueCommand('', { listTemplates: true });

            // Should not try to create an issue
            expect(api.createIssue).not.toHaveBeenCalled();
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining('No templates found')
            );
        });
    });
});

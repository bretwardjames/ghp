/**
 * Tests for the tool registry
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs
vi.mock('fs', () => ({
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
}));

// Mock os
vi.mock('os', () => ({
    homedir: vi.fn(() => '/home/testuser'),
}));

// Mock child_process
vi.mock('child_process', () => ({
    execSync: vi.fn(() => '/test/repo'),
    exec: vi.fn(),
}));

// Mock util for promisify
vi.mock('util', async () => {
    const actual = await vi.importActual<typeof import('util')>('util');
    return {
        ...actual,
        promisify: vi.fn(() => vi.fn()),
    };
});

// Mock @bretwardjames/ghp-core
vi.mock('@bretwardjames/ghp-core', () => ({
    getCurrentBranch: vi.fn(),
    executeHooksForEvent: vi.fn(() => []),
    hasHooksForEvent: vi.fn(() => false),
    branchExists: vi.fn(),
    createBranch: vi.fn(),
    checkoutBranch: vi.fn(),
    generateBranchName: vi.fn(),
    createWorktree: vi.fn(),
    removeWorktree: vi.fn(),
    listWorktrees: vi.fn(),
    extractIssueNumberFromBranch: vi.fn(),
    createPRWorkflow: vi.fn(),
    removeWorktreeWorkflow: vi.fn(),
    validateNumericInput: vi.fn((n) => n),
    validateSafeString: vi.fn((s) => s),
    BranchLinker: vi.fn(),
}));

// Import after mocks
import { loadMcpConfig, getToolList, registerEnabledTools } from './tool-registry.js';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';

describe('tool-registry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('loadMcpConfig', () => {
        it('should return default config when no config files exist', () => {
            vi.mocked(existsSync).mockReturnValue(false);

            const config = loadMcpConfig();

            expect(config).toEqual({
                tools: {
                    read: true,
                    action: true,
                },
                disabledTools: [],
            });
        });

        it('should merge user config with defaults', () => {
            vi.mocked(existsSync).mockImplementation((path) => {
                return String(path).includes('.config/ghp-cli');
            });
            vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
                mcp: {
                    tools: { read: false },
                    disabledTools: ['create_issue'],
                },
            }));

            const config = loadMcpConfig();

            expect(config.tools?.read).toBe(false);
            expect(config.tools?.action).toBe(true); // from defaults
            expect(config.disabledTools).toContain('create_issue');
        });

        it('should prefer workspace config over user config', () => {
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockImplementation((path) => {
                if (String(path).includes('.ghp/config.json')) {
                    return JSON.stringify({
                        mcp: { tools: { action: false } },
                    });
                }
                return JSON.stringify({
                    mcp: { tools: { action: true } },
                });
            });

            const config = loadMcpConfig();

            expect(config.tools?.action).toBe(false); // workspace wins
        });

        it('should handle JSON with comments', () => {
            vi.mocked(existsSync).mockImplementation((path) => {
                return String(path).includes('.config/ghp-cli');
            });
            vi.mocked(readFileSync).mockReturnValue(`{
                // This is a comment
                "mcp": {
                    /* Block comment */
                    "tools": { "read": false }
                }
            }`);

            const config = loadMcpConfig();

            expect(config.tools?.read).toBe(false);
        });

        it('should handle missing git repo gracefully', () => {
            vi.mocked(execSync).mockImplementation(() => {
                throw new Error('Not a git repo');
            });
            vi.mocked(existsSync).mockReturnValue(false);

            const config = loadMcpConfig();

            // Should still return defaults
            expect(config.tools?.read).toBe(true);
            expect(config.tools?.action).toBe(true);
        });
    });

    describe('getToolList', () => {
        it('should return all registered tools with their categories', () => {
            const tools = getToolList();

            // Should have multiple tools
            expect(tools.length).toBeGreaterThan(0);

            // Each tool should have name and category
            for (const tool of tools) {
                expect(tool).toHaveProperty('name');
                expect(tool).toHaveProperty('category');
                expect(['read', 'action']).toContain(tool.category);
            }

            // Check some expected tools exist
            const toolNames = tools.map(t => t.name);
            expect(toolNames).toContain('create_issue');
            expect(toolNames).toContain('get_my_work'); // actual tool name
        });
    });

    describe('registerEnabledTools', () => {
        it('should register tools based on config', () => {
            const mockServer = {
                registerTool: vi.fn(),
            };
            const mockContext = {
                ensureAuthenticated: vi.fn(),
                getRepo: vi.fn(),
                api: {},
            };

            // All categories enabled
            registerEnabledTools(mockServer as any, mockContext as any, {
                tools: { read: true, action: true },
                disabledTools: [],
            });

            // Should have registered multiple tools
            expect(mockServer.registerTool).toHaveBeenCalled();
        });

        it('should skip disabled categories', () => {
            const mockServer = {
                registerTool: vi.fn(),
            };
            const mockContext = {
                ensureAuthenticated: vi.fn(),
                getRepo: vi.fn(),
                api: {},
            };

            // Only read category enabled
            registerEnabledTools(mockServer as any, mockContext as any, {
                tools: { read: true, action: false },
                disabledTools: [],
            });

            // Get the names of registered tools
            const registeredNames = mockServer.registerTool.mock.calls.map(
                (call) => call[0]
            );

            // Should only have read tools (list_work_items, view_plan)
            // No action tools (create_issue, move_issue, etc.)
            expect(registeredNames).not.toContain('create_issue');
            expect(registeredNames).not.toContain('move_issue');
        });

        it('should skip specifically disabled tools', () => {
            const mockServer = {
                registerTool: vi.fn(),
            };
            const mockContext = {
                ensureAuthenticated: vi.fn(),
                getRepo: vi.fn(),
                api: {},
            };

            // All categories enabled but specific tool disabled
            registerEnabledTools(mockServer as any, mockContext as any, {
                tools: { read: true, action: true },
                disabledTools: ['create_issue'],
            });

            const registeredNames = mockServer.registerTool.mock.calls.map(
                (call) => call[0]
            );

            expect(registeredNames).not.toContain('create_issue');
            // Other action tools should still be registered
            expect(registeredNames).toContain('move_issue');
        });

        it('should skip tools with disabledByDefault when not explicitly enabled', () => {
            const mockServer = {
                registerTool: vi.fn(),
            };
            const mockContext = {
                ensureAuthenticated: vi.fn(),
                getRepo: vi.fn(),
                api: {},
            };

            // Default config - no enabledTools
            registerEnabledTools(mockServer as any, mockContext as any, {
                tools: { read: true, action: true },
                disabledTools: [],
            });

            const registeredNames = mockServer.registerTool.mock.calls.map(
                (call) => call[0]
            );

            // New tools with disabledByDefault should NOT be registered
            expect(registeredNames).not.toContain('create_pr');
            expect(registeredNames).not.toContain('merge_pr');
            expect(registeredNames).not.toContain('list_worktrees');
            expect(registeredNames).not.toContain('get_issue');

            // Original tools should still be registered
            expect(registeredNames).toContain('move_issue');
            expect(registeredNames).toContain('create_issue');
        });

        it('should enable tools with disabledByDefault when in enabledTools', () => {
            const mockServer = {
                registerTool: vi.fn(),
            };
            const mockContext = {
                ensureAuthenticated: vi.fn(),
                getRepo: vi.fn(),
                api: {},
            };

            // Explicitly enable some opt-in tools
            registerEnabledTools(mockServer as any, mockContext as any, {
                tools: { read: true, action: true },
                disabledTools: [],
                enabledTools: ['create_pr', 'list_worktrees'],
            });

            const registeredNames = mockServer.registerTool.mock.calls.map(
                (call) => call[0]
            );

            // These should now be registered
            expect(registeredNames).toContain('create_pr');
            expect(registeredNames).toContain('list_worktrees');

            // These are still disabled by default and not in enabledTools
            expect(registeredNames).not.toContain('merge_pr');
            expect(registeredNames).not.toContain('get_issue');
        });
    });

    describe('loadMcpConfig with enabledTools', () => {
        it('should load enabledTools from user config', () => {
            vi.mocked(existsSync).mockImplementation((path) => {
                return String(path).includes('.config/ghp-cli');
            });
            vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
                mcp: {
                    enabledTools: ['create_pr', 'merge_pr'],
                },
            }));

            const config = loadMcpConfig();

            expect(config.enabledTools).toEqual(['create_pr', 'merge_pr']);
        });

        it('should merge enabledTools from user and workspace config', () => {
            // Reset to ensure clean state
            vi.mocked(execSync).mockReturnValue('/test/repo');
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockImplementation((path) => {
                const pathStr = String(path);
                if (pathStr.includes('.config/ghp-cli')) {
                    // User config: /home/testuser/.config/ghp-cli/config.json
                    return JSON.stringify({
                        mcp: { enabledTools: ['create_pr'] },
                    });
                }
                // Workspace config: /test/repo/.ghp/config.json
                return JSON.stringify({
                    mcp: { enabledTools: ['list_worktrees'] },
                });
            });

            const config = loadMcpConfig();

            // Should have both user and workspace enabledTools
            expect(config.enabledTools).toContain('create_pr');
            expect(config.enabledTools).toContain('list_worktrees');
            expect(config.enabledTools).toHaveLength(2);
        });
    });
});

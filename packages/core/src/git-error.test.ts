/**
 * Tests for GitError class
 */

import { describe, it, expect } from 'vitest';
import { GitError } from './types.js';

describe('GitError', () => {
    it('should store all context properties', () => {
        const error = new GitError({
            message: 'Git command failed',
            command: 'git checkout branch',
            stderr: 'error: pathspec did not match any file(s)',
            exitCode: 1,
            cwd: '/home/user/repo',
        });

        expect(error.message).toBe('Git command failed');
        expect(error.command).toBe('git checkout branch');
        expect(error.stderr).toBe('error: pathspec did not match any file(s)');
        expect(error.exitCode).toBe(1);
        expect(error.cwd).toBe('/home/user/repo');
        expect(error.name).toBe('GitError');
    });

    it('should be an instance of Error', () => {
        const error = new GitError({
            message: 'Test error',
            command: 'git status',
            stderr: '',
            exitCode: 0,
            cwd: '/tmp',
        });

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(GitError);
    });

    it('should handle null exitCode (killed process)', () => {
        const error = new GitError({
            message: 'Process killed',
            command: 'git clone large-repo',
            stderr: '',
            exitCode: null,
            cwd: '/tmp',
        });

        expect(error.exitCode).toBeNull();
    });

    it('should provide detailed string representation', () => {
        const error = new GitError({
            message: 'Branch not found',
            command: 'git checkout nonexistent',
            stderr: "error: pathspec 'nonexistent' did not match any file(s)",
            exitCode: 1,
            cwd: '/home/user/project',
        });

        const detailed = error.toDetailedString();

        expect(detailed).toContain('GitError: Branch not found');
        expect(detailed).toContain('Command: git checkout nonexistent');
        expect(detailed).toContain('CWD: /home/user/project');
        expect(detailed).toContain('Exit code: 1');
        expect(detailed).toContain('Stderr: error: pathspec');
    });

    it('should omit stderr in detailed string if empty', () => {
        const error = new GitError({
            message: 'Command failed',
            command: 'git status',
            stderr: '',
            exitCode: 1,
            cwd: '/tmp',
        });

        const detailed = error.toDetailedString();

        expect(detailed).not.toContain('Stderr:');
    });

    it('should be catchable by type', async () => {
        const throwGitError = async () => {
            throw new GitError({
                message: 'Test error',
                command: 'git test',
                stderr: 'test stderr',
                exitCode: 128,
                cwd: '/tmp',
            });
        };

        let caughtError: unknown;
        try {
            await throwGitError();
        } catch (error) {
            caughtError = error;
        }

        expect(caughtError).toBeInstanceOf(GitError);
        if (caughtError instanceof GitError) {
            expect(caughtError.exitCode).toBe(128);
            expect(caughtError.stderr).toBe('test stderr');
        }
    });

    it('should distinguish different exit codes', () => {
        // Exit code 1: general error
        const error1 = new GitError({
            message: 'General error',
            command: 'git show-ref --verify refs/heads/nonexistent',
            stderr: '',
            exitCode: 1,
            cwd: '/tmp',
        });

        // Exit code 128: fatal error (like not a git repo)
        const error128 = new GitError({
            message: 'Fatal error',
            command: 'git status',
            stderr: 'fatal: not a git repository',
            exitCode: 128,
            cwd: '/not-a-repo',
        });

        expect(error1.exitCode).toBe(1);
        expect(error128.exitCode).toBe(128);

        // Can be used for conditional handling
        const isNotGitRepo = (e: GitError) => e.exitCode === 128 && e.stderr.includes('not a git repository');
        expect(isNotGitRepo(error128)).toBe(true);
        expect(isNotGitRepo(error1)).toBe(false);
    });
});

import { describe, it, expect } from 'vitest';
import {
    createNamespace,
    issueNamespace,
    branchNamespace,
    userNamespace,
    appNamespace,
    sessionNamespace,
    parseNamespace,
    isNamespaceType,
    getIssueRelatedNamespaces,
} from '../namespaces.js';

describe('namespaces', () => {
    describe('createNamespace', () => {
        it('should create namespace with default prefix', () => {
            const ns = createNamespace('issue', 123);
            expect(ns).toBe('ghp-issue-123');
        });

        it('should create namespace with custom prefix', () => {
            const ns = createNamespace('issue', 123, { prefix: 'lift-care' });
            expect(ns).toBe('lift-care-issue-123');
        });

        it('should sanitize identifiers', () => {
            const ns = createNamespace('branch', 'feature/my-branch');
            expect(ns).toBe('ghp-branch-feature-my-branch');
        });

        it('should lowercase identifiers', () => {
            const ns = createNamespace('user', 'BretWardJames');
            expect(ns).toBe('ghp-user-bretwardjames');
        });

        it('should handle special characters', () => {
            const ns = createNamespace('branch', 'feat/add@something#weird!');
            expect(ns).toBe('ghp-branch-feat-add-something-weird');
        });
    });

    describe('typed namespace functions', () => {
        it('issueNamespace creates issue namespace', () => {
            expect(issueNamespace(42)).toBe('ghp-issue-42');
        });

        it('branchNamespace creates branch namespace', () => {
            expect(branchNamespace('main')).toBe('ghp-branch-main');
        });

        it('userNamespace creates user namespace', () => {
            expect(userNamespace('alice')).toBe('ghp-user-alice');
        });

        it('appNamespace creates app namespace', () => {
            expect(appNamespace('settings')).toBe('ghp-app-settings');
            expect(appNamespace()).toBe('ghp-app-general');
        });

        it('sessionNamespace creates session namespace', () => {
            expect(sessionNamespace('abc123')).toBe('ghp-session-abc123');
        });
    });

    describe('parseNamespace', () => {
        it('should parse valid namespaces', () => {
            const parsed = parseNamespace('ghp-issue-123');

            expect(parsed).toEqual({
                prefix: 'ghp',
                type: 'issue',
                identifier: '123',
            });
        });

        it('should parse custom prefix', () => {
            const parsed = parseNamespace('lift-care-branch-main');

            expect(parsed).toEqual({
                prefix: 'lift-care',
                type: 'branch',
                identifier: 'main',
            });
        });

        it('should handle complex identifiers', () => {
            const parsed = parseNamespace('ghp-branch-feature-add-tests');

            expect(parsed).toEqual({
                prefix: 'ghp',
                type: 'branch',
                identifier: 'feature-add-tests',
            });
        });

        it('should return null for invalid namespaces', () => {
            expect(parseNamespace('invalid')).toBeNull();
            expect(parseNamespace('ghp-invalid-123')).toBeNull();
            expect(parseNamespace('')).toBeNull();
        });
    });

    describe('isNamespaceType', () => {
        it('should return true for matching type', () => {
            expect(isNamespaceType('ghp-issue-123', 'issue')).toBe(true);
            expect(isNamespaceType('ghp-branch-main', 'branch')).toBe(true);
        });

        it('should return false for non-matching type', () => {
            expect(isNamespaceType('ghp-issue-123', 'branch')).toBe(false);
        });

        it('should return false for invalid namespace', () => {
            expect(isNamespaceType('invalid', 'issue')).toBe(false);
        });
    });

    describe('getIssueRelatedNamespaces', () => {
        it('should return just issue namespace without linked branch', () => {
            const namespaces = getIssueRelatedNamespaces(42);
            expect(namespaces).toEqual(['ghp-issue-42']);
        });

        it('should return issue and branch namespaces with linked branch', () => {
            const namespaces = getIssueRelatedNamespaces(42, 'feature/issue-42');
            expect(namespaces).toEqual([
                'ghp-issue-42',
                'ghp-branch-feature-issue-42',
            ]);
        });

        it('should respect custom prefix', () => {
            const namespaces = getIssueRelatedNamespaces(42, 'main', { prefix: 'custom' });
            expect(namespaces).toEqual([
                'custom-issue-42',
                'custom-branch-main',
            ]);
        });
    });
});

/**
 * Tests for config utility functions
 */

import { describe, it, expect } from 'vitest';
import { getByPath, setByPath, deepMergeObjects, isPlainObject } from './config.js';

describe('isPlainObject', () => {
    it('returns true for plain objects', () => {
        expect(isPlainObject({})).toBe(true);
        expect(isPlainObject({ foo: 'bar' })).toBe(true);
    });

    it('returns false for arrays', () => {
        expect(isPlainObject([])).toBe(false);
        expect(isPlainObject([1, 2, 3])).toBe(false);
    });

    it('returns false for null', () => {
        expect(isPlainObject(null)).toBe(false);
    });

    it('returns false for primitives', () => {
        expect(isPlainObject('string')).toBe(false);
        expect(isPlainObject(42)).toBe(false);
        expect(isPlainObject(true)).toBe(false);
        expect(isPlainObject(undefined)).toBe(false);
    });
});

describe('deepMergeObjects', () => {
    it('merges top-level properties', () => {
        const base = { a: 1, b: 2 };
        const override = { b: 3, c: 4 };
        expect(deepMergeObjects(base, override)).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('recursively merges nested objects', () => {
        const base = { nested: { a: 1, b: 2 } };
        const override = { nested: { b: 3, c: 4 } };
        expect(deepMergeObjects(base, override)).toEqual({
            nested: { a: 1, b: 3, c: 4 },
        });
    });

    it('merges deeply nested objects', () => {
        const base = { level1: { level2: { level3: { a: 1 } } } };
        const override = { level1: { level2: { level3: { b: 2 } } } };
        expect(deepMergeObjects(base, override)).toEqual({
            level1: { level2: { level3: { a: 1, b: 2 } } },
        });
    });

    it('override replaces arrays (no array merging)', () => {
        const base = { items: [1, 2, 3] };
        const override = { items: [4, 5] };
        expect(deepMergeObjects(base, override)).toEqual({ items: [4, 5] });
    });

    it('override replaces primitives with objects', () => {
        const base = { value: 'string' };
        const override = { value: { nested: true } };
        expect(deepMergeObjects(base, override)).toEqual({
            value: { nested: true },
        });
    });

    it('override replaces objects with primitives', () => {
        const base = { value: { nested: true } };
        const override = { value: 'string' };
        expect(deepMergeObjects(base, override)).toEqual({ value: 'string' });
    });

    it('ignores undefined values in override', () => {
        const base = { a: 1, b: 2 };
        const override = { a: undefined, c: 3 };
        expect(deepMergeObjects(base, override)).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('does not modify original objects', () => {
        const base = { nested: { a: 1 } };
        const override = { nested: { b: 2 } };
        const result = deepMergeObjects(base, override);

        expect(base).toEqual({ nested: { a: 1 } });
        expect(override).toEqual({ nested: { b: 2 } });
        expect(result).toEqual({ nested: { a: 1, b: 2 } });
    });

    it('handles mcp.tools config merge correctly (the original bug)', () => {
        // This is the exact scenario that was failing before the fix
        const workspace = { mcp: { tools: { read: false } } };
        const user = { mcp: { tools: { action: false } } };

        expect(deepMergeObjects(workspace, user)).toEqual({
            mcp: { tools: { read: false, action: false } },
        });
    });

    it('handles complex config merge with multiple nested levels', () => {
        const defaults = {
            mcp: {
                tools: { read: true, action: true },
                disabledTools: [],
            },
            parallelWork: {
                openTerminal: true,
                autoRunClaude: true,
            },
        };
        const workspace = {
            mcp: { tools: { read: false } },
        };
        const user = {
            mcp: { tools: { action: false }, disabledTools: ['tool1'] },
            parallelWork: { autoRunClaude: false },
        };

        // First merge: defaults + workspace
        const afterWorkspace = deepMergeObjects(defaults, workspace);
        expect(afterWorkspace).toEqual({
            mcp: {
                tools: { read: false, action: true },
                disabledTools: [],
            },
            parallelWork: {
                openTerminal: true,
                autoRunClaude: true,
            },
        });

        // Second merge: (defaults + workspace) + user
        const final = deepMergeObjects(afterWorkspace, user);
        expect(final).toEqual({
            mcp: {
                tools: { read: false, action: false },
                disabledTools: ['tool1'],
            },
            parallelWork: {
                openTerminal: true,
                autoRunClaude: false,
            },
        });
    });
});

describe('getByPath', () => {
    it('returns top-level value', () => {
        const obj = { foo: 'bar' };
        expect(getByPath(obj, 'foo')).toBe('bar');
    });

    it('returns nested value', () => {
        const obj = { foo: { bar: 'baz' } };
        expect(getByPath(obj, 'foo.bar')).toBe('baz');
    });

    it('returns deeply nested value', () => {
        const obj = { a: { b: { c: { d: 'deep' } } } };
        expect(getByPath(obj, 'a.b.c.d')).toBe('deep');
    });

    it('returns undefined for non-existent path', () => {
        const obj = { foo: 'bar' };
        expect(getByPath(obj, 'baz')).toBeUndefined();
    });

    it('returns undefined for non-existent nested path', () => {
        const obj = { foo: { bar: 'baz' } };
        expect(getByPath(obj, 'foo.missing.path')).toBeUndefined();
    });

    it('returns undefined when traversing through primitive', () => {
        const obj = { foo: 'bar' };
        expect(getByPath(obj, 'foo.nested')).toBeUndefined();
    });

    it('returns array values', () => {
        const obj = { items: [1, 2, 3] };
        expect(getByPath(obj, 'items')).toEqual([1, 2, 3]);
    });

    it('returns nested object', () => {
        const obj = { config: { tools: { enabled: true } } };
        expect(getByPath(obj, 'config.tools')).toEqual({ enabled: true });
    });
});

describe('setByPath', () => {
    it('sets top-level value', () => {
        const obj: Record<string, unknown> = {};
        setByPath(obj, 'foo', 'bar');
        expect(obj.foo).toBe('bar');
    });

    it('sets nested value', () => {
        const obj: Record<string, unknown> = {};
        setByPath(obj, 'foo.bar', 'baz');
        expect(obj).toEqual({ foo: { bar: 'baz' } });
    });

    it('sets deeply nested value', () => {
        const obj: Record<string, unknown> = {};
        setByPath(obj, 'a.b.c.d', 'deep');
        expect(obj).toEqual({ a: { b: { c: { d: 'deep' } } } });
    });

    it('creates intermediate objects', () => {
        const obj: Record<string, unknown> = { existing: true };
        setByPath(obj, 'new.nested.value', 42);
        expect(obj).toEqual({
            existing: true,
            new: { nested: { value: 42 } },
        });
    });

    it('overwrites existing value', () => {
        const obj: Record<string, unknown> = { foo: { bar: 'old' } };
        setByPath(obj, 'foo.bar', 'new');
        expect(obj.foo).toEqual({ bar: 'new' });
    });

    it('adds to existing nested object', () => {
        const obj: Record<string, unknown> = { foo: { existing: true } };
        setByPath(obj, 'foo.new', 'value');
        expect(obj.foo).toEqual({ existing: true, new: 'value' });
    });

    it('replaces null with object', () => {
        const obj: Record<string, unknown> = { foo: null };
        setByPath(obj, 'foo.bar', 'baz');
        expect(obj).toEqual({ foo: { bar: 'baz' } });
    });

    it('throws when traversing through string', () => {
        const obj: Record<string, unknown> = { foo: 'string' };
        expect(() => setByPath(obj, 'foo.bar', 'value')).toThrow(
            'Cannot set "foo.bar": "foo" is a string, not an object'
        );
    });

    it('throws when traversing through number', () => {
        const obj: Record<string, unknown> = { count: 42 };
        expect(() => setByPath(obj, 'count.nested', 'value')).toThrow(
            'Cannot set "count.nested": "count" is a number, not an object'
        );
    });

    it('throws when traversing through boolean', () => {
        const obj: Record<string, unknown> = { enabled: true };
        expect(() => setByPath(obj, 'enabled.nested', 'value')).toThrow(
            'Cannot set "enabled.nested": "enabled" is a boolean, not an object'
        );
    });

    it('throws when traversing through array', () => {
        const obj: Record<string, unknown> = { items: [1, 2, 3] };
        expect(() => setByPath(obj, 'items.nested', 'value')).toThrow(
            'Cannot set "items.nested": "items" is an array, not an object'
        );
    });

    it('throws with correct path in error for deep traversal', () => {
        const obj: Record<string, unknown> = { a: { b: 'string' } };
        expect(() => setByPath(obj, 'a.b.c.d', 'value')).toThrow(
            'Cannot set "a.b.c.d": "a.b" is a string, not an object'
        );
    });
});

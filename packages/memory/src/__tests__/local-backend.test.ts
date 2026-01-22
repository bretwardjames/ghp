import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LocalMemoryBackend } from '../backends/local.js';

describe('LocalMemoryBackend', () => {
    let backend: LocalMemoryBackend;
    let testDir: string;

    beforeEach(async () => {
        // Create a unique temp directory for each test
        testDir = path.join(os.tmpdir(), `ghp-memory-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        backend = new LocalMemoryBackend({ storagePath: testDir });
    });

    afterEach(async () => {
        // Clean up test directory
        try {
            await fs.rm(testDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    describe('save', () => {
        it('should save a memory and return it with generated id', async () => {
            const memory = await backend.save({
                namespace: 'test-namespace',
                content: 'Test content',
                metadata: { foo: 'bar' },
            });

            expect(memory.id).toBeDefined();
            expect(memory.namespace).toBe('test-namespace');
            expect(memory.content).toBe('Test content');
            expect(memory.metadata).toEqual({ foo: 'bar' });
            expect(memory.createdAt).toBeInstanceOf(Date);
            expect(memory.updatedAt).toBeInstanceOf(Date);
        });

        it('should generate unique ids for each memory', async () => {
            const memory1 = await backend.save({ namespace: 'ns', content: 'content1' });
            const memory2 = await backend.save({ namespace: 'ns', content: 'content2' });

            expect(memory1.id).not.toBe(memory2.id);
        });
    });

    describe('get', () => {
        it('should retrieve a saved memory by id', async () => {
            const saved = await backend.save({
                namespace: 'test',
                content: 'Hello world',
            });

            const retrieved = await backend.get(saved.id);

            expect(retrieved).not.toBeNull();
            expect(retrieved!.id).toBe(saved.id);
            expect(retrieved!.content).toBe('Hello world');
        });

        it('should return null for non-existent id', async () => {
            const result = await backend.get('non-existent-id');
            expect(result).toBeNull();
        });
    });

    describe('list', () => {
        it('should list memories in a namespace', async () => {
            await backend.save({ namespace: 'ns1', content: 'content1' });
            await backend.save({ namespace: 'ns1', content: 'content2' });
            await backend.save({ namespace: 'ns2', content: 'content3' });

            const ns1Memories = await backend.list({ namespace: 'ns1' });
            const ns2Memories = await backend.list({ namespace: 'ns2' });

            expect(ns1Memories).toHaveLength(2);
            expect(ns2Memories).toHaveLength(1);
        });

        it('should support pagination', async () => {
            await backend.save({ namespace: 'ns', content: 'content1' });
            await backend.save({ namespace: 'ns', content: 'content2' });
            await backend.save({ namespace: 'ns', content: 'content3' });

            const page1 = await backend.list({ namespace: 'ns', limit: 2, offset: 0 });
            const page2 = await backend.list({ namespace: 'ns', limit: 2, offset: 2 });

            expect(page1).toHaveLength(2);
            expect(page2).toHaveLength(1);
        });

        it('should return empty array for non-existent namespace', async () => {
            const result = await backend.list({ namespace: 'non-existent' });
            expect(result).toEqual([]);
        });
    });

    describe('search', () => {
        beforeEach(async () => {
            await backend.save({ namespace: 'search-ns', content: 'The quick brown fox jumps over the lazy dog' });
            await backend.save({ namespace: 'search-ns', content: 'A quick response to the user query' });
            await backend.save({ namespace: 'search-ns', content: 'Something completely different' });
            await backend.save({ namespace: 'other-ns', content: 'Quick fox in another namespace' });
        });

        it('should find memories matching query', async () => {
            const results = await backend.search({ query: 'quick fox' });

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].score).toBeGreaterThan(0);
        });

        it('should filter by namespace', async () => {
            const results = await backend.search({ query: 'quick', namespace: 'search-ns' });

            expect(results.every(r => r.memory.namespace === 'search-ns')).toBe(true);
        });

        it('should respect limit', async () => {
            const results = await backend.search({ query: 'quick', limit: 1 });

            expect(results).toHaveLength(1);
        });

        it('should return results sorted by score descending', async () => {
            const results = await backend.search({ query: 'quick' });

            for (let i = 1; i < results.length; i++) {
                expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
            }
        });
    });

    describe('update', () => {
        it('should update content', async () => {
            const saved = await backend.save({ namespace: 'ns', content: 'original' });
            const updated = await backend.update(saved.id, { content: 'modified' });

            expect(updated.content).toBe('modified');
            expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(saved.updatedAt.getTime());
        });

        it('should merge metadata', async () => {
            const saved = await backend.save({
                namespace: 'ns',
                content: 'test',
                metadata: { a: 1, b: 2 },
            });

            const updated = await backend.update(saved.id, { metadata: { b: 3, c: 4 } });

            expect(updated.metadata).toEqual({ a: 1, b: 3, c: 4 });
        });

        it('should throw for non-existent id', async () => {
            await expect(backend.update('non-existent', { content: 'new' }))
                .rejects.toThrow('Memory not found');
        });
    });

    describe('delete', () => {
        it('should delete a memory', async () => {
            const saved = await backend.save({ namespace: 'ns', content: 'test' });

            const deleted = await backend.delete(saved.id);

            expect(deleted).toBe(true);
            expect(await backend.get(saved.id)).toBeNull();
        });

        it('should return false for non-existent id', async () => {
            const result = await backend.delete('non-existent');
            expect(result).toBe(false);
        });
    });

    describe('deleteNamespace', () => {
        it('should delete all memories in namespace', async () => {
            await backend.save({ namespace: 'ns1', content: 'a' });
            await backend.save({ namespace: 'ns1', content: 'b' });
            await backend.save({ namespace: 'ns2', content: 'c' });

            const count = await backend.deleteNamespace('ns1');

            expect(count).toBe(2);
            expect(await backend.list({ namespace: 'ns1' })).toHaveLength(0);
            expect(await backend.list({ namespace: 'ns2' })).toHaveLength(1);
        });

        it('should return 0 for non-existent namespace', async () => {
            const count = await backend.deleteNamespace('non-existent');
            expect(count).toBe(0);
        });
    });

    describe('isAvailable', () => {
        it('should return true when storage is accessible', async () => {
            const available = await backend.isAvailable();
            expect(available).toBe(true);
        });
    });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StateStore, StateStoreCapacityError } from './state-store.js';

type Entry = { createdAt: number; payload: string };

describe('StateStore', () => {
    let store: StateStore<Entry>;

    beforeEach(() => {
        vi.useFakeTimers();
        store = new StateStore<Entry>(10_000); // 10s TTL
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('stores and retrieves an entry', () => {
        store.set('key1', { createdAt: Date.now(), payload: 'hello' });
        const entry = store.take('key1');
        expect(entry?.payload).toBe('hello');
    });

    it('take is single-use — second call returns null', () => {
        store.set('key1', { createdAt: Date.now(), payload: 'hello' });
        expect(store.take('key1')?.payload).toBe('hello');
        expect(store.take('key1')).toBeNull();
    });

    it('expires entries older than the TTL', () => {
        store.set('key1', { createdAt: Date.now(), payload: 'hello' });
        vi.advanceTimersByTime(11_000);
        expect(store.take('key1')).toBeNull();
    });

    it('sweeps expired entries on set/take/size', () => {
        store.set('a', { createdAt: Date.now(), payload: 'x' });
        store.set('b', { createdAt: Date.now(), payload: 'y' });
        expect(store.size()).toBe(2);
        vi.advanceTimersByTime(11_000);
        expect(store.size()).toBe(0);
    });

    it('returns null for unknown keys', () => {
        expect(store.take('nope')).toBeNull();
    });

    it('throws StateStoreCapacityError once maxEntries is reached', () => {
        const capped = new StateStore<Entry>(10_000, 3);
        capped.set('a', { createdAt: Date.now(), payload: 'x' });
        capped.set('b', { createdAt: Date.now(), payload: 'x' });
        capped.set('c', { createdAt: Date.now(), payload: 'x' });
        expect(() =>
            capped.set('d', { createdAt: Date.now(), payload: 'x' })
        ).toThrow(StateStoreCapacityError);
    });
});

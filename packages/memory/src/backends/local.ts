import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type {
    Memory,
    MemoryBackend,
    MemoryCreateOptions,
    MemorySearchOptions,
    MemorySearchResult,
    MemoryListOptions,
    MemoryUpdateOptions,
} from '../types.js';

export interface LocalBackendConfig {
    /** Path to store memory files (default: ~/.ghp/memories) */
    storagePath?: string;
}

interface StoredMemory {
    id: string;
    namespace: string;
    content: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

interface MemoryIndex {
    version: 1;
    memories: Record<string, StoredMemory>;
    namespaceIndex: Record<string, string[]>; // namespace -> memory IDs
}

/**
 * File-based memory backend using JSON storage.
 *
 * This is the fallback backend that works without any external dependencies.
 * It stores all memories in a single JSON file with an index for fast lookups.
 *
 * For search, it uses simple substring matching with a basic relevance score.
 * For production use with large memory stores, consider using a vector database backend.
 */
export class LocalMemoryBackend implements MemoryBackend {
    readonly name = 'local';
    private readonly storagePath: string;
    private readonly indexPath: string;
    private indexCache: MemoryIndex | null = null;

    constructor(config: LocalBackendConfig = {}) {
        this.storagePath = config.storagePath || path.join(os.homedir(), '.ghp', 'memories');
        this.indexPath = path.join(this.storagePath, 'index.json');
    }

    async save(options: MemoryCreateOptions): Promise<Memory> {
        const index = await this.loadIndex();
        const now = new Date();
        const id = this.generateId();

        const stored: StoredMemory = {
            id,
            namespace: options.namespace,
            content: options.content,
            metadata: options.metadata,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        };

        index.memories[id] = stored;

        // Update namespace index
        if (!index.namespaceIndex[options.namespace]) {
            index.namespaceIndex[options.namespace] = [];
        }
        index.namespaceIndex[options.namespace].push(id);

        await this.saveIndex(index);

        return this.toMemory(stored);
    }

    async search(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
        const index = await this.loadIndex();
        const results: MemorySearchResult[] = [];
        const queryLower = options.query.toLowerCase();
        const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 0);

        // Get memories to search
        let memoryIds: string[];
        if (options.namespace) {
            memoryIds = index.namespaceIndex[options.namespace] || [];
        } else {
            memoryIds = Object.keys(index.memories);
        }

        for (const id of memoryIds) {
            const stored = index.memories[id];
            if (!stored) continue;

            const score = this.calculateRelevance(stored.content, queryTerms);
            const minScore = options.minScore ?? 0;

            if (score > minScore) {
                results.push({
                    memory: this.toMemory(stored),
                    score,
                });
            }
        }

        // Sort by score descending
        results.sort((a, b) => b.score - a.score);

        // Apply limit
        const limit = options.limit ?? 10;
        return results.slice(0, limit);
    }

    async list(options: MemoryListOptions): Promise<Memory[]> {
        const index = await this.loadIndex();
        const memoryIds = index.namespaceIndex[options.namespace] || [];

        const offset = options.offset ?? 0;
        const limit = options.limit ?? 100;
        const slicedIds = memoryIds.slice(offset, offset + limit);

        return slicedIds
            .map(id => index.memories[id])
            .filter((m): m is StoredMemory => m !== undefined)
            .map(m => this.toMemory(m));
    }

    async get(id: string): Promise<Memory | null> {
        const index = await this.loadIndex();
        const stored = index.memories[id];
        return stored ? this.toMemory(stored) : null;
    }

    async update(id: string, options: MemoryUpdateOptions): Promise<Memory> {
        const index = await this.loadIndex();
        const stored = index.memories[id];

        if (!stored) {
            throw new Error(`Memory not found: ${id}`);
        }

        if (options.content !== undefined) {
            stored.content = options.content;
        }

        if (options.metadata !== undefined) {
            stored.metadata = { ...stored.metadata, ...options.metadata };
        }

        stored.updatedAt = new Date().toISOString();

        await this.saveIndex(index);

        return this.toMemory(stored);
    }

    async delete(id: string): Promise<boolean> {
        const index = await this.loadIndex();
        const stored = index.memories[id];

        if (!stored) {
            return false;
        }

        // Remove from namespace index
        const namespaceIds = index.namespaceIndex[stored.namespace];
        if (namespaceIds) {
            const idx = namespaceIds.indexOf(id);
            if (idx !== -1) {
                namespaceIds.splice(idx, 1);
            }
            if (namespaceIds.length === 0) {
                delete index.namespaceIndex[stored.namespace];
            }
        }

        // Remove from memories
        delete index.memories[id];

        await this.saveIndex(index);

        return true;
    }

    async deleteNamespace(namespace: string): Promise<number> {
        const index = await this.loadIndex();
        const memoryIds = index.namespaceIndex[namespace] || [];
        const count = memoryIds.length;

        // Delete all memories in namespace
        for (const id of memoryIds) {
            delete index.memories[id];
        }

        // Remove namespace from index
        delete index.namespaceIndex[namespace];

        await this.saveIndex(index);

        return count;
    }

    async isAvailable(): Promise<boolean> {
        try {
            // Try to ensure storage directory exists
            await fs.mkdir(this.storagePath, { recursive: true });
            // Try to load or create index
            await this.loadIndex();
            return true;
        } catch {
            return false;
        }
    }

    // Private methods

    private async loadIndex(): Promise<MemoryIndex> {
        if (this.indexCache) {
            return this.indexCache;
        }

        try {
            await fs.mkdir(this.storagePath, { recursive: true });
            const data = await fs.readFile(this.indexPath, 'utf-8');
            this.indexCache = JSON.parse(data) as MemoryIndex;
            return this.indexCache;
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                // File doesn't exist, create empty index
                const emptyIndex: MemoryIndex = {
                    version: 1,
                    memories: {},
                    namespaceIndex: {},
                };
                this.indexCache = emptyIndex;
                return emptyIndex;
            }
            throw err;
        }
    }

    private async saveIndex(index: MemoryIndex): Promise<void> {
        await fs.mkdir(this.storagePath, { recursive: true });
        await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf-8');
        this.indexCache = index;
    }

    private generateId(): string {
        return crypto.randomUUID();
    }

    private toMemory(stored: StoredMemory): Memory {
        return {
            id: stored.id,
            namespace: stored.namespace,
            content: stored.content,
            metadata: stored.metadata,
            createdAt: new Date(stored.createdAt),
            updatedAt: new Date(stored.updatedAt),
        };
    }

    /**
     * Calculate a simple relevance score based on term frequency.
     * Score is normalized between 0 and 1.
     */
    private calculateRelevance(content: string, queryTerms: string[]): number {
        if (queryTerms.length === 0) return 0;

        const contentLower = content.toLowerCase();
        let matchedTerms = 0;
        let totalOccurrences = 0;

        for (const term of queryTerms) {
            const regex = new RegExp(this.escapeRegex(term), 'gi');
            const matches = contentLower.match(regex);
            if (matches) {
                matchedTerms++;
                totalOccurrences += matches.length;
            }
        }

        // Score based on:
        // - Percentage of query terms that matched
        // - Density of matches in content
        const termCoverage = matchedTerms / queryTerms.length;
        const density = Math.min(1, totalOccurrences / (content.length / 100));

        return (termCoverage * 0.7) + (density * 0.3);
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

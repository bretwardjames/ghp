import type { MemoryBackend, MemoryConfig } from './types.js';
import { LocalMemoryBackend } from './backends/local.js';

/**
 * Create a memory backend based on configuration.
 *
 * Currently only supports the local backend.
 * Other backends (mem0, pinecone, weaviate, custom) will be added in future phases.
 */
export function createMemoryBackend(config?: MemoryConfig): MemoryBackend {
    const backendType = config?.backend ?? 'local';

    switch (backendType) {
        case 'local':
            return new LocalMemoryBackend(config?.local);

        case 'mem0':
            // TODO: Implement in Phase 7
            throw new Error('mem0 backend not yet implemented. Use local backend for now.');

        case 'pinecone':
            // TODO: Implement in Phase 7
            throw new Error('Pinecone backend not yet implemented. Use local backend for now.');

        case 'weaviate':
            // TODO: Implement in Phase 7
            throw new Error('Weaviate backend not yet implemented. Use local backend for now.');

        case 'custom':
            // TODO: Implement in Phase 7
            throw new Error('Custom backend not yet implemented. Use local backend for now.');

        default:
            throw new Error(`Unknown backend type: ${backendType}`);
    }
}

/**
 * Create the default local memory backend.
 * Useful when you don't need configuration.
 */
export function createLocalBackend(storagePath?: string): LocalMemoryBackend {
    return new LocalMemoryBackend({ storagePath });
}

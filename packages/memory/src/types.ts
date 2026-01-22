/**
 * Represents a single memory entry stored in the backend
 */
export interface Memory {
    /** Unique identifier for this memory */
    id: string;
    /** The namespace this memory belongs to (e.g., "ghp-issue-123") */
    namespace: string;
    /** The actual content of the memory */
    content: string;
    /** Optional metadata attached to the memory */
    metadata?: Record<string, unknown>;
    /** Timestamp when the memory was created */
    createdAt: Date;
    /** Timestamp when the memory was last updated */
    updatedAt: Date;
}

/**
 * Options for creating a new memory
 */
export interface MemoryCreateOptions {
    /** The namespace to store the memory in */
    namespace: string;
    /** The content to store */
    content: string;
    /** Optional metadata to attach */
    metadata?: Record<string, unknown>;
}

/**
 * Options for searching memories
 */
export interface MemorySearchOptions {
    /** The query string to search for */
    query: string;
    /** Namespace to search within (optional - searches all if not specified) */
    namespace?: string;
    /** Maximum number of results to return */
    limit?: number;
    /** Minimum relevance score (0-1) for results */
    minScore?: number;
}

/**
 * A search result with relevance score
 */
export interface MemorySearchResult {
    /** The matched memory */
    memory: Memory;
    /** Relevance score (0-1, higher is more relevant) */
    score: number;
}

/**
 * Options for listing memories
 */
export interface MemoryListOptions {
    /** Namespace to list from */
    namespace: string;
    /** Maximum number of results */
    limit?: number;
    /** Offset for pagination */
    offset?: number;
}

/**
 * Options for updating a memory
 */
export interface MemoryUpdateOptions {
    /** New content (optional) */
    content?: string;
    /** New/updated metadata (merged with existing) */
    metadata?: Record<string, unknown>;
}

/**
 * The core interface that all memory backends must implement.
 *
 * Backends can be:
 * - Local file-based storage (always available)
 * - mem0 cloud service
 * - Pinecone vector database
 * - Weaviate vector database
 * - Custom user-provided implementations
 */
export interface MemoryBackend {
    /** Human-readable name of this backend */
    readonly name: string;

    /**
     * Save a new memory
     * @returns The created memory with generated ID
     */
    save(options: MemoryCreateOptions): Promise<Memory>;

    /**
     * Search for memories by query
     * @returns Matching memories with relevance scores
     */
    search(options: MemorySearchOptions): Promise<MemorySearchResult[]>;

    /**
     * List all memories in a namespace
     */
    list(options: MemoryListOptions): Promise<Memory[]>;

    /**
     * Get a specific memory by ID
     * @returns The memory or null if not found
     */
    get(id: string): Promise<Memory | null>;

    /**
     * Update an existing memory
     * @returns The updated memory
     * @throws Error if memory not found
     */
    update(id: string, options: MemoryUpdateOptions): Promise<Memory>;

    /**
     * Delete a specific memory by ID
     * @returns true if deleted, false if not found
     */
    delete(id: string): Promise<boolean>;

    /**
     * Delete all memories in a namespace
     * @returns Number of memories deleted
     */
    deleteNamespace(namespace: string): Promise<number>;

    /**
     * Check if the backend is properly configured and available
     */
    isAvailable(): Promise<boolean>;
}

/**
 * Configuration for the memory system
 */
export interface MemoryConfig {
    /** Which backend to use */
    backend: 'local' | 'mem0' | 'pinecone' | 'weaviate' | 'custom';
    /** Prefix for all namespaces (default: "ghp") */
    namespacePrefix?: string;
    /** Local backend configuration */
    local?: {
        /** Path to store memory files (default: ~/.ghp/memories) */
        storagePath?: string;
    };
    /** mem0 backend configuration */
    mem0?: {
        apiKey: string;
    };
    /** Pinecone backend configuration */
    pinecone?: {
        apiKey: string;
        environment: string;
        indexName: string;
    };
    /** Weaviate backend configuration */
    weaviate?: {
        host: string;
        apiKey?: string;
    };
    /** Custom backend configuration */
    custom?: {
        /** Path to the custom backend module */
        modulePath: string;
    };
}

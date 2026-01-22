// Types
export type {
    Memory,
    MemoryBackend,
    MemoryConfig,
    MemoryCreateOptions,
    MemorySearchOptions,
    MemorySearchResult,
    MemoryListOptions,
    MemoryUpdateOptions,
} from './types.js';

// Backends
export { LocalMemoryBackend } from './backends/local.js';
export type { LocalBackendConfig } from './backends/local.js';

// Factory
export { createMemoryBackend, createLocalBackend } from './factory.js';

// Namespace helpers
export {
    createNamespace,
    issueNamespace,
    branchNamespace,
    userNamespace,
    appNamespace,
    sessionNamespace,
    parseNamespace,
    isNamespaceType,
    getIssueRelatedNamespaces,
} from './namespaces.js';
export type { NamespaceType, NamespaceOptions } from './namespaces.js';

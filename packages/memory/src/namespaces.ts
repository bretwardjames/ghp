/**
 * Namespace helpers for organizing memories.
 *
 * Namespaces follow the pattern: {prefix}-{type}-{identifier}
 * Examples:
 *   - ghp-issue-123
 *   - ghp-branch-feature/my-feature
 *   - ghp-user-bretwardjames
 *   - ghp-app-general
 */

export type NamespaceType = 'issue' | 'branch' | 'user' | 'app' | 'session';

export interface NamespaceOptions {
    /** The prefix for all namespaces (default: "ghp") */
    prefix?: string;
}

const DEFAULT_PREFIX = 'ghp';

/**
 * Create a namespace string from components
 */
export function createNamespace(
    type: NamespaceType,
    identifier: string | number,
    options: NamespaceOptions = {}
): string {
    const prefix = options.prefix || DEFAULT_PREFIX;
    // Sanitize identifier: replace invalid chars with dashes, lowercase
    const sanitizedId = String(identifier)
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    return `${prefix}-${type}-${sanitizedId}`;
}

/**
 * Create a namespace for an issue
 */
export function issueNamespace(
    issueNumber: number,
    options: NamespaceOptions = {}
): string {
    return createNamespace('issue', issueNumber, options);
}

/**
 * Create a namespace for a branch
 */
export function branchNamespace(
    branchName: string,
    options: NamespaceOptions = {}
): string {
    return createNamespace('branch', branchName, options);
}

/**
 * Create a namespace for a user
 */
export function userNamespace(
    username: string,
    options: NamespaceOptions = {}
): string {
    return createNamespace('user', username, options);
}

/**
 * Create a namespace for app-wide memories
 */
export function appNamespace(
    appName: string = 'general',
    options: NamespaceOptions = {}
): string {
    return createNamespace('app', appName, options);
}

/**
 * Create a namespace for a work session
 */
export function sessionNamespace(
    sessionId: string,
    options: NamespaceOptions = {}
): string {
    return createNamespace('session', sessionId, options);
}

/**
 * Parse a namespace string into its components
 * @returns null if the namespace doesn't match the expected pattern
 */
export function parseNamespace(namespace: string): {
    prefix: string;
    type: NamespaceType;
    identifier: string;
} | null {
    const match = namespace.match(/^([a-z0-9-]+)-(issue|branch|user|app|session)-(.+)$/);
    if (!match) {
        return null;
    }

    return {
        prefix: match[1],
        type: match[2] as NamespaceType,
        identifier: match[3],
    };
}

/**
 * Check if a namespace belongs to a specific type
 */
export function isNamespaceType(namespace: string, type: NamespaceType): boolean {
    const parsed = parseNamespace(namespace);
    return parsed !== null && parsed.type === type;
}

/**
 * Get all related namespaces for an issue (issue + its branch if linked)
 */
export function getIssueRelatedNamespaces(
    issueNumber: number,
    linkedBranch?: string,
    options: NamespaceOptions = {}
): string[] {
    const namespaces = [issueNamespace(issueNumber, options)];
    if (linkedBranch) {
        namespaces.push(branchNamespace(linkedBranch, options));
    }
    return namespaces;
}

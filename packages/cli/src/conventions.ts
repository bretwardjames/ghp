/**
 * Project Conventions - CLI wrapper
 *
 * Thin wrapper around @bretwardjames/ghp-core conventions module
 * that automatically resolves the repository root for CLI usage.
 */

import { execSync } from 'child_process';
import {
    loadProjectConventions as coreLoadConventions,
    buildConventionsContext as coreBuildContext,
    getIssueReferenceText as coreGetIssueRefText,
    type ProjectConventions,
} from '@bretwardjames/ghp-core';

// Re-export types
export type { ProjectConventions } from '@bretwardjames/ghp-core';

/**
 * Get repository root synchronously (CLI-specific)
 */
function getRepoRootSync(): string | null {
    try {
        return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
    } catch {
        return null;
    }
}

/**
 * Load project conventions from CLAUDE.md (auto-detects repo root)
 */
export function loadProjectConventions(): ProjectConventions {
    const repoRoot = getRepoRootSync();
    if (!repoRoot) {
        // Return empty conventions if not in a repo
        return {
            claudeMd: null,
            pr: {
                issueReference: null,
                coAuthorFormat: null,
                titleFormat: null,
                bodyFormat: null,
            },
            commit: {
                format: null,
                coAuthorFormat: null,
            },
            issue: {
                titleFormat: null,
                bodyStructure: null,
            },
        };
    }
    return coreLoadConventions(repoRoot);
}

// Re-export other functions directly from core
export { buildConventionsContext, getIssueReferenceText } from '@bretwardjames/ghp-core';

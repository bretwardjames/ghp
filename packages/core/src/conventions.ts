/**
 * Project Conventions Reader
 *
 * Reads CLAUDE.md and other convention files to extract
 * patterns that should be followed by AI-generated content.
 *
 * This is in core so both CLI and VS Code extension can use it.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface ProjectConventions {
    /** Raw content of CLAUDE.md if it exists */
    claudeMd: string | null;
    /** Extracted PR conventions */
    pr: {
        /** How to reference issues (e.g., "Relates to #XX" vs "Closes #XX") */
        issueReference: 'relates' | 'closes' | 'fixes' | null;
        /** Co-author format if specified */
        coAuthorFormat: string | null;
        /** PR title format hints */
        titleFormat: string | null;
        /** PR body template hints */
        bodyFormat: string | null;
    };
    /** Extracted commit conventions */
    commit: {
        /** Commit message format (conventional commits, etc.) */
        format: string | null;
        /** Co-author format */
        coAuthorFormat: string | null;
    };
    /** Extracted issue conventions */
    issue: {
        /** Issue title format */
        titleFormat: string | null;
        /** Issue body structure */
        bodyStructure: string | null;
    };
}

/**
 * Extract issue reference convention from content
 */
function extractIssueReferenceConvention(content: string): 'relates' | 'closes' | 'fixes' | null {
    const lowerContent = content.toLowerCase();

    // Look for explicit instructions about issue references
    if (lowerContent.includes('relates to') && lowerContent.includes('not') &&
        (lowerContent.includes('closes') || lowerContent.includes('fixes'))) {
        return 'relates';
    }

    if (lowerContent.includes('use "closes"') || lowerContent.includes("use 'closes'")) {
        return 'closes';
    }

    if (lowerContent.includes('use "fixes"') || lowerContent.includes("use 'fixes'")) {
        return 'fixes';
    }

    // Check for patterns in examples
    const relatesMatch = content.match(/relates to #\d+/i);
    const closesMatch = content.match(/closes #\d+/i);
    const fixesMatch = content.match(/fixes #\d+/i);

    // If explicit "Relates to" is mentioned more prominently
    if (relatesMatch && !closesMatch && !fixesMatch) {
        return 'relates';
    }

    return null;
}

/**
 * Extract co-author format from content
 */
function extractCoAuthorFormat(content: string): string | null {
    // Look for Co-Authored-By patterns
    const match = content.match(/Co-Authored-By:\s*[^\n]+/i);
    if (match) {
        return match[0];
    }
    return null;
}

/**
 * Load project conventions from a repository root path
 *
 * @param repoRoot - The repository root directory path
 * @returns ProjectConventions object with extracted patterns
 */
export function loadProjectConventions(repoRoot: string): ProjectConventions {
    let claudeMd: string | null = null;

    try {
        const claudeMdPath = join(repoRoot, 'CLAUDE.md');
        if (existsSync(claudeMdPath)) {
            claudeMd = readFileSync(claudeMdPath, 'utf-8');
        }
    } catch {
        // Ignore errors reading CLAUDE.md
    }

    const conventions: ProjectConventions = {
        claudeMd,
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

    if (claudeMd) {
        // Extract PR conventions
        conventions.pr.issueReference = extractIssueReferenceConvention(claudeMd);
        conventions.pr.coAuthorFormat = extractCoAuthorFormat(claudeMd);
        conventions.commit.coAuthorFormat = conventions.pr.coAuthorFormat;

        // Look for commit message section
        const commitSection = claudeMd.match(/## Commit Messages?\s*\n([\s\S]*?)(?=\n##|\n$|$)/i);
        if (commitSection) {
            conventions.commit.format = commitSection[1].trim();
        }
    }

    return conventions;
}

/**
 * Build a context string for AI about project conventions
 */
export function buildConventionsContext(conventions: ProjectConventions): string {
    const parts: string[] = [];

    if (conventions.pr.issueReference) {
        const refMap = {
            'relates': 'Use "Relates to #XX" (not "Closes" or "Fixes") unless the PR actually closes the issue',
            'closes': 'Use "Closes #XX" to reference issues',
            'fixes': 'Use "Fixes #XX" to reference issues',
        };
        parts.push(`Issue References: ${refMap[conventions.pr.issueReference]}`);
    }

    if (conventions.pr.coAuthorFormat) {
        parts.push(`Co-Author Format: ${conventions.pr.coAuthorFormat}`);
    }

    if (conventions.commit.format) {
        parts.push(`Commit Format:\n${conventions.commit.format}`);
    }

    if (parts.length === 0 && conventions.claudeMd) {
        // Fall back to including relevant sections of CLAUDE.md
        const relevantSections = conventions.claudeMd
            .split('\n')
            .filter(line =>
                line.toLowerCase().includes('commit') ||
                line.toLowerCase().includes('pr') ||
                line.toLowerCase().includes('pull request') ||
                line.toLowerCase().includes('issue') ||
                line.toLowerCase().includes('relates') ||
                line.toLowerCase().includes('closes')
            )
            .slice(0, 20)
            .join('\n');

        if (relevantSections) {
            parts.push(`Project Guidelines:\n${relevantSections}`);
        }
    }

    return parts.join('\n\n');
}

/**
 * Get the appropriate issue reference text
 */
export function getIssueReferenceText(
    issueNumber: number,
    conventions: ProjectConventions,
    actuallyCloses: boolean = false
): string {
    // If the PR actually closes the issue, use Closes/Fixes
    if (actuallyCloses) {
        if (conventions.pr.issueReference === 'fixes') {
            return `Fixes #${issueNumber}`;
        }
        return `Closes #${issueNumber}`;
    }

    // Otherwise, follow the convention
    switch (conventions.pr.issueReference) {
        case 'relates':
            return `Relates to #${issueNumber}`;
        case 'closes':
            return `Closes #${issueNumber}`;
        case 'fixes':
            return `Fixes #${issueNumber}`;
        default:
            return `Relates to #${issueNumber}`;
    }
}

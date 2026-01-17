/**
 * Branch-issue linking with pluggable storage.
 *
 * The BranchLinker class manages associations between git branches and GitHub issues.
 * Storage is abstracted via the StorageAdapter interface, allowing different backends:
 * - File system (for CLI)
 * - VSCode workspaceState (for extensions)
 * - In-memory (for testing)
 *
 * @example CLI usage with file storage:
 * ```typescript
 * import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
 * import { homedir } from 'os';
 * import { join } from 'path';
 *
 * const DATA_DIR = join(homedir(), '.config', 'ghp-cli');
 * const LINKS_FILE = join(DATA_DIR, 'branch-links.json');
 *
 * const fileAdapter: StorageAdapter = {
 *   load() {
 *     if (existsSync(LINKS_FILE)) {
 *       return JSON.parse(readFileSync(LINKS_FILE, 'utf-8'));
 *     }
 *     return [];
 *   },
 *   save(links) {
 *     if (!existsSync(DATA_DIR)) {
 *       mkdirSync(DATA_DIR, { recursive: true });
 *     }
 *     writeFileSync(LINKS_FILE, JSON.stringify(links, null, 2));
 *   }
 * };
 *
 * const linker = new BranchLinker(fileAdapter);
 * ```
 *
 * @example VSCode usage with workspaceState:
 * ```typescript
 * const vscodeAdapter: StorageAdapter = {
 *   load() {
 *     return context.workspaceState.get<BranchLink[]>('branchLinks', []);
 *   },
 *   save(links) {
 *     context.workspaceState.update('branchLinks', links);
 *   }
 * };
 *
 * const linker = new BranchLinker(vscodeAdapter);
 * ```
 */

import type { BranchLink, StorageAdapter } from './types.js';

/**
 * Manages branch-issue links using a pluggable storage adapter.
 */
export class BranchLinker {
    private storage: StorageAdapter;

    constructor(storage: StorageAdapter) {
        this.storage = storage;
    }

    /**
     * Load links from storage (handles both sync and async adapters)
     */
    private async loadLinks(): Promise<BranchLink[]> {
        const result = this.storage.load();
        return result instanceof Promise ? await result : result;
    }

    /**
     * Save links to storage (handles both sync and async adapters)
     */
    private async saveLinks(links: BranchLink[]): Promise<void> {
        const result = this.storage.save(links);
        if (result instanceof Promise) {
            await result;
        }
    }

    /**
     * Create a link between a branch and an issue.
     * If a link already exists for this branch or issue in this repo, it will be replaced.
     */
    async link(
        branch: string,
        issueNumber: number,
        issueTitle: string,
        itemId: string,
        repo: string
    ): Promise<void> {
        const links = await this.loadLinks();

        // Remove existing link for this branch or issue in this repo
        const filtered = links.filter(l =>
            !(l.repo === repo && (l.branch === branch || l.issueNumber === issueNumber))
        );

        filtered.push({
            branch,
            issueNumber,
            issueTitle,
            itemId,
            repo,
            linkedAt: new Date().toISOString(),
        });

        await this.saveLinks(filtered);
    }

    /**
     * Remove the link for an issue.
     * @returns true if a link was removed, false if no link existed
     */
    async unlink(repo: string, issueNumber: number): Promise<boolean> {
        const links = await this.loadLinks();
        const filtered = links.filter(l =>
            !(l.repo === repo && l.issueNumber === issueNumber)
        );

        if (filtered.length === links.length) {
            return false;
        }

        await this.saveLinks(filtered);
        return true;
    }

    /**
     * Remove the link for a branch.
     * @returns true if a link was removed, false if no link existed
     */
    async unlinkBranch(repo: string, branch: string): Promise<boolean> {
        const links = await this.loadLinks();
        const filtered = links.filter(l =>
            !(l.repo === repo && l.branch === branch)
        );

        if (filtered.length === links.length) {
            return false;
        }

        await this.saveLinks(filtered);
        return true;
    }

    /**
     * Get the branch linked to an issue.
     */
    async getBranchForIssue(repo: string, issueNumber: number): Promise<string | null> {
        const links = await this.loadLinks();
        const link = links.find(l => l.repo === repo && l.issueNumber === issueNumber);
        return link?.branch || null;
    }

    /**
     * Get the full link info for a branch.
     */
    async getLinkForBranch(repo: string, branch: string): Promise<BranchLink | null> {
        const links = await this.loadLinks();
        return links.find(l => l.repo === repo && l.branch === branch) || null;
    }

    /**
     * Get the full link info for an issue.
     */
    async getLinkForIssue(repo: string, issueNumber: number): Promise<BranchLink | null> {
        const links = await this.loadLinks();
        return links.find(l => l.repo === repo && l.issueNumber === issueNumber) || null;
    }

    /**
     * Get all links for a repository.
     */
    async getLinksForRepo(repo: string): Promise<BranchLink[]> {
        const links = await this.loadLinks();
        return links.filter(l => l.repo === repo);
    }

    /**
     * Get all links.
     */
    async getAllLinks(): Promise<BranchLink[]> {
        return this.loadLinks();
    }

    /**
     * Check if a branch has a link.
     */
    async hasLinkForBranch(repo: string, branch: string): Promise<boolean> {
        const link = await this.getLinkForBranch(repo, branch);
        return link !== null;
    }

    /**
     * Check if an issue has a link.
     */
    async hasLinkForIssue(repo: string, issueNumber: number): Promise<boolean> {
        const link = await this.getLinkForIssue(repo, issueNumber);
        return link !== null;
    }
}

/**
 * Create an in-memory storage adapter for testing.
 */
export function createInMemoryAdapter(): StorageAdapter & { links: BranchLink[] } {
    const adapter = {
        links: [] as BranchLink[],
        load() {
            return [...this.links];
        },
        save(links: BranchLink[]) {
            this.links = [...links];
        },
    };
    return adapter;
}

import {
    detectRepository,
    isGitRepository,
    type RepoInfo,
} from '@bretwardjames/ghp-core';

/**
 * Manages repository context detection for the MCP server.
 * Detects the current repository from the working directory.
 */
export class RepoContext {
    private cachedRepo: RepoInfo | null = null;
    private cwd: string;

    constructor(cwd?: string) {
        this.cwd = cwd ?? process.cwd();
    }

    /**
     * Gets the current repository info, with caching.
     * Returns null if not in a git repository or can't detect remote.
     */
    async getRepo(): Promise<RepoInfo | null> {
        if (this.cachedRepo) {
            return this.cachedRepo;
        }

        const isRepo = await isGitRepository({ cwd: this.cwd });
        if (!isRepo) {
            return null;
        }

        this.cachedRepo = await detectRepository({ cwd: this.cwd });
        return this.cachedRepo;
    }

    /**
     * Forces re-detection of the repository.
     */
    async refresh(): Promise<RepoInfo | null> {
        this.cachedRepo = null;
        return this.getRepo();
    }

    /**
     * Checks if we're in a valid git repository with a GitHub remote.
     */
    async isValid(): Promise<boolean> {
        const repo = await this.getRepo();
        return repo !== null;
    }

    /**
     * Updates the working directory and clears the cache.
     */
    setCwd(cwd: string): void {
        this.cwd = cwd;
        this.cachedRepo = null;
    }

    /**
     * Gets the current working directory.
     */
    getCwd(): string {
        return this.cwd;
    }
}

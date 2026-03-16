import {
    detectRepository,
    isGitRepository,
    type RepoInfo,
} from '@bretwardjames/ghp-core';

/**
 * Manages repository context detection for the MCP server.
 * Detects the current repository from the working directory,
 * or returns a hard-locked repo when created via `RepoContext.locked()`.
 */
export class RepoContext {
    private cachedRepo: RepoInfo | null = null;
    private cwd: string;
    private readonly lockedRepo?: RepoInfo;

    constructor(cwd?: string) {
        this.cwd = cwd ?? process.cwd();
    }

    /**
     * Creates a RepoContext that is permanently locked to a specific repo.
     * Git detection is skipped entirely — `getRepo()` always returns the locked value.
     */
    static locked(repo: RepoInfo): RepoContext {
        const ctx = new RepoContext();
        (ctx as { lockedRepo?: RepoInfo }).lockedRepo = repo;
        ctx.cachedRepo = repo;
        return ctx;
    }

    /**
     * Gets the current repository info, with caching.
     * Returns the locked repo immediately if set, otherwise detects from git.
     */
    async getRepo(): Promise<RepoInfo | null> {
        if (this.lockedRepo) {
            return this.lockedRepo;
        }

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
     * No-op when locked to a specific repo.
     */
    async refresh(): Promise<RepoInfo | null> {
        if (this.lockedRepo) {
            return this.lockedRepo;
        }
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
     * No-op when locked to a specific repo.
     */
    setCwd(cwd: string): void {
        if (this.lockedRepo) {
            return;
        }
        this.cwd = cwd;
        this.cachedRepo = null;
    }

    /**
     * Gets the current working directory.
     */
    getCwd(): string {
        return this.cwd;
    }

    /**
     * Returns true if this context is locked to a specific repo.
     */
    isLocked(): boolean {
        return this.lockedRepo !== undefined;
    }
}

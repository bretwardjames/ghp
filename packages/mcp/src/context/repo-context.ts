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

    private constructor(options: { cwd?: string; lockedRepo?: RepoInfo } = {}) {
        this.cwd = options.cwd ?? process.cwd();
        this.lockedRepo = options.lockedRepo;
        if (this.lockedRepo) {
            this.cachedRepo = this.lockedRepo;
        }
    }

    /**
     * Creates a RepoContext that auto-detects the repo from the working directory.
     */
    static auto(cwd?: string): RepoContext {
        return new RepoContext({ cwd });
    }

    /**
     * Creates a RepoContext that is permanently locked to a specific repo.
     * Git detection is skipped entirely — `getRepo()` always returns the locked value.
     */
    static locked(repo: RepoInfo): RepoContext {
        return new RepoContext({ lockedRepo: repo });
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

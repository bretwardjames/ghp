/**
 * Worktree utilities for the ghp CLI.
 * Shared functions for worktree setup and management.
 */

import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, copyFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { getWorktreeConfig, getConfig } from './config.js';
import {
    createWorktree as coreCreateWorktree,
    generateWorktreePath,
    getWorktreeForBranch,
    getRepositoryRoot,
    checkoutBranch,
    GitError,
    type WorktreeInfo,
    type RepoInfo,
} from './git-utils.js';

const execAsync = promisify(exec);

/**
 * Setup a worktree for parallel work: copy configured files and run setup command.
 *
 * @param worktreePath - Path to the newly created worktree
 * @param sourcePath - Path to the source repository (to copy files from)
 */
export async function setupWorktree(worktreePath: string, sourcePath: string): Promise<void> {
    const config = getWorktreeConfig();

    // Copy configured files
    for (const file of config.copyFiles) {
        const srcFile = join(sourcePath, file);
        const destFile = join(worktreePath, file);

        if (existsSync(srcFile)) {
            // Ensure destination directory exists
            const destDir = dirname(destFile);
            if (!existsSync(destDir)) {
                mkdirSync(destDir, { recursive: true });
            }

            copyFileSync(srcFile, destFile);
            console.log(chalk.dim(`  Copied ${file}`));
        }
    }

    // Run setup command if enabled
    if (config.autoSetup && config.setupCommand) {
        console.log(chalk.dim(`  Running: ${config.setupCommand}`));
        try {
            await execAsync(config.setupCommand, { cwd: worktreePath });
            console.log(chalk.green('✓'), 'Setup complete');
        } catch (error) {
            console.log(chalk.yellow('⚠'), 'Setup command failed (you may need to run it manually)');
            if (error instanceof Error) {
                console.log(chalk.dim(`  Error: ${error.message}`));
            }
        }
    }
}

export type CreateWorktreeResult = {
    success: true;
    path: string;
    alreadyExisted: boolean;
} | {
    success: false;
    error: string;
    existingWorktreePath?: string;
}

/**
 * Create a parallel worktree for an issue and set it up.
 * Handles the case where the branch is already checked out in main repo
 * by switching main to the default branch first.
 *
 * @param repo - Repository info
 * @param issueNumber - Issue number for path generation
 * @param branchName - Branch to checkout in the worktree
 * @param issueTitle - Optional issue title for descriptive directory names
 * @param customPath - Optional custom worktree path
 */
export async function createParallelWorktree(
    repo: RepoInfo,
    issueNumber: number,
    branchName: string,
    issueTitle?: string,
    customPath?: string
): Promise<CreateWorktreeResult> {
    const config = getWorktreeConfig();
    const repoRoot = await getRepositoryRoot();

    if (!repoRoot) {
        return {
            success: false,
            error: 'Could not determine repository root. Are you inside a git repository?',
        };
    }

    // Generate worktree path with descriptive name if title provided
    const wtPath = customPath || generateWorktreePath(config.path, repo.name, issueNumber, issueTitle);

    // Check if worktree already exists for this branch
    const existingWorktree = await getWorktreeForBranch(branchName);
    if (existingWorktree) {
        if (existingWorktree.isMain) {
            // Branch is checked out in main repo - switch main to default branch first
            console.log(chalk.yellow('Note:'), `Branch "${branchName}" is currently checked out in main repo.`);
            console.log(chalk.dim('Switching main repo to default branch before creating worktree...'));

            const mainBranch = getConfig('mainBranch') || 'main';
            try {
                await checkoutBranch(mainBranch);
                console.log(chalk.green('✓'), `Switched main repo to ${mainBranch}`);
            } catch (error) {
                return {
                    success: false,
                    error: `Failed to switch main repo to ${mainBranch}. You may have uncommitted changes.`,
                };
            }
        } else {
            // Non-main worktree already exists
            console.log(chalk.yellow('Worktree already exists:'), existingWorktree.path);
            return {
                success: true,
                path: existingWorktree.path,
                alreadyExisted: true,
            };
        }
    }

    // Ensure parent directory exists
    const parentDir = dirname(wtPath);
    if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
    }

    console.log(chalk.dim('Creating worktree for'), `#${issueNumber}...`);

    // Create the worktree
    try {
        await coreCreateWorktree(wtPath, branchName);
    } catch (error) {
        // Check if worktree was created by another process (race condition)
        const nowExists = await getWorktreeForBranch(branchName);
        if (nowExists && !nowExists.isMain) {
            return {
                success: true,
                path: nowExists.path,
                alreadyExisted: true,
            };
        }
        // Include stderr from GitError for better diagnostics
        const errorMessage = error instanceof GitError && error.stderr
            ? `${error.message}\n${error.stderr}`
            : error instanceof Error ? error.message : String(error);
        return {
            success: false,
            error: errorMessage,
        };
    }

    console.log(chalk.green('✓'), `Created worktree: ${wtPath}`);

    // Setup the worktree (copy files, run setup command)
    await setupWorktree(wtPath, repoRoot);

    return {
        success: true,
        path: wtPath,
        alreadyExisted: false,
    };
}

/**
 * Check if a branch is in an existing worktree (not the main repo).
 * Returns the worktree info if found.
 */
export async function getBranchWorktree(branchName: string): Promise<WorktreeInfo | null> {
    const worktree = await getWorktreeForBranch(branchName);
    if (worktree && !worktree.isMain) {
        return worktree;
    }
    return null;
}

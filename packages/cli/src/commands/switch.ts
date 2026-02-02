import chalk from 'chalk';
import { api } from '../github-api.js';
import {
    detectRepository,
    checkoutBranch,
    branchExists,
    getCurrentBranch,
} from '../git-utils.js';
import { getBranchForIssue } from '../branch-linker.js';
import { applyActiveLabel } from '../active-label.js';
import { promptSelectWithDefault, isInteractive } from '../prompts.js';
import { createParallelWorktree, getBranchWorktree } from '../worktree-utils.js';
import { getConfig, getParallelWorkConfig, type TerminalMode } from '../config.js';
import { openParallelWorkTerminal } from '../terminal-utils.js';
import type { SubagentSpawnDirective } from '../types.js';
import { exit } from '../exit.js';

interface SwitchOptions {
    /** Create worktree instead of switching branches (parallel work mode) */
    parallel?: boolean;
    /** Custom path for parallel worktree */
    worktreePath?: string;
    /** Whether to open a terminal (default: true with --parallel, set to false with --no-open) */
    open?: boolean;
    // Terminal mode overrides
    /** Use nvim with claudecode.nvim plugin */
    nvim?: boolean;
    /** Use claude CLI directly */
    claude?: boolean;
    /** Just open terminal, no Claude */
    terminalOnly?: boolean;
}

/**
 * Get terminal mode override from CLI options.
 */
function getTerminalModeOverride(options: SwitchOptions): TerminalMode | undefined {
    if (options.nvim) return 'nvim-claude';
    if (options.claude) return 'claude';
    if (options.terminalOnly) return 'terminal';
    return undefined;
}

export async function switchCommand(issue: string, options: SwitchOptions = {}): Promise<void> {
    const issueNumber = parseInt(issue, 10);
    if (isNaN(issueNumber)) {
        console.error(chalk.red('Error:'), 'Issue must be a number');
        exit(1);
    }

    // Detect repository
    const repo = await detectRepository();
    if (!repo) {
        console.error(chalk.red('Error:'), 'Not in a git repository with a GitHub remote');
        exit(1);
    }

    // Authenticate (needed to read issue body)
    const authenticated = await api.authenticate();
    if (!authenticated) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run', chalk.cyan('ghp auth'));
        exit(1);
    }

    // Find linked branch
    const branchName = await getBranchForIssue(repo, issueNumber);
    if (!branchName) {
        console.error(chalk.red('Error:'), `No branch linked to issue #${issueNumber}`);
        console.log(chalk.dim('Use'), chalk.cyan(`ghp link-branch ${issueNumber}`), chalk.dim('to link a branch'));
        exit(1);
    }

    // Fetch issue details for title (used in worktree path naming)
    const item = await api.findItemByNumber(repo, issueNumber);
    const issueTitle = item?.title || `issue-${issueNumber}`;

    // Check if branch exists
    if (!(await branchExists(branchName))) {
        console.error(chalk.red('Error:'), `Branch "${branchName}" no longer exists`);
        exit(1);
    }

    // Track if we're in parallel mode
    let isParallelMode = options.parallel === true;
    let worktreePath: string | undefined;

    // Check if already on that branch
    const currentBranch = await getCurrentBranch();
    const alreadyOnBranch = currentBranch === branchName;

    if (alreadyOnBranch && !options.parallel) {
        console.log(chalk.yellow('Already on branch:'), branchName);
        // Still apply the active label
        await applyActiveLabel(repo, issueNumber, true);
        return;
    }

    // Determine work mode: switch or parallel
    let workMode: 'switch' | 'parallel' = 'switch';

    if (options.parallel) {
        workMode = 'parallel';
    } else if (isInteractive()) {
        // Interactive: ask user how they want to work
        const choices = [
            'Switch to branch (default)',
            'Create parallel worktree (stay here, work in new directory)',
        ];
        const choice = await promptSelectWithDefault(
            'How would you like to work on this issue?',
            choices,
            0 // default: switch
        );
        if (choice === 1) {
            workMode = 'parallel';
            isParallelMode = true;
        }
    }

    if (workMode === 'parallel') {
        // ─────────────────────────────────────────────────────────────────────
        // Parallel mode: create worktree
        // ─────────────────────────────────────────────────────────────────────
        const result = await createParallelWorktree(
            repo,
            issueNumber,
            branchName,
            issueTitle,
            options.worktreePath
        );
        if (!result.success) {
            console.error(chalk.red('Error:'), result.error);
            exit(1);
        }
        worktreePath = result.path;
    } else {
        // ─────────────────────────────────────────────────────────────────────
        // Switch mode: checkout the branch
        // ─────────────────────────────────────────────────────────────────────

        // Check if branch is already in a worktree
        const existingWorktree = await getBranchWorktree(branchName);
        if (existingWorktree) {
            console.log(chalk.yellow('Branch is in a worktree:'), existingWorktree.path);
            console.log(chalk.dim('Run:'), `cd ${existingWorktree.path}`);
            worktreePath = existingWorktree.path;
            isParallelMode = true; // Treat as parallel for label handling
        } else {
            try {
                await checkoutBranch(branchName);
                console.log(chalk.green('✓'), `Switched to branch: ${branchName}`);
            } catch (error) {
                console.error(chalk.red('Error:'), 'Failed to switch branch:', error);
                exit(1);
            }
        }
    }

    // Update active label (non-exclusive in parallel mode)
    await applyActiveLabel(repo, issueNumber, !isParallelMode);

    // Show path info for parallel worktree
    if (isParallelMode && worktreePath) {
        console.log();
        console.log(chalk.cyan('Worktree at:'), worktreePath);

        // Fetch issue details for the directive
        const issueDetails = await api.getIssueDetails(repo, issueNumber);
        const issueTitle = issueDetails?.title || `Issue #${issueNumber}`;
        // Note: IssueDetails has 'state' (open/closed), not project status
        // Project status would require a separate query to project items
        const issueStatus: string | null = null;

        const mainBranch = getConfig('mainBranch') || 'main';
        // TODO: Use getConfig('memory.namespacePrefix') once memory config is fully integrated
        const namespacePrefix = 'ghp';

        const directive: SubagentSpawnDirective = {
            action: 'spawn_subagent',
            workingDirectory: worktreePath,
            issue: {
                number: issueNumber,
                title: issueTitle,
                status: issueStatus,
                url: `https://github.com/${repo.owner}/${repo.name}/issues/${issueNumber}`,
            },
            branch: branchName,
            repository: {
                owner: repo.owner,
                name: repo.name,
                mainBranch,
            },
            memory: {
                namespace: `${namespacePrefix}-issue-${issueNumber}`,
            },
            handoffPrompt: `You are now working in a dedicated worktree for issue #${issueNumber}: "${issueTitle}"

Worktree Location: ${worktreePath}
Branch: ${branchName}
Status: ${issueStatus || 'None'}
Repository: ${repo.owner}/${repo.name}

Your task is to implement this issue. The worktree has:
- Dependencies installed (if worktreeAutoSetup is enabled)
- Environment files copied from the main repository
- Isolated git state with the issue branch checked out

Use the GHP tools available via MCP to:
- Save your progress with save_session
- Search for relevant context with memory_search
- Mark the issue done when complete`,
        };

        // Determine if we should open a terminal
        const parallelWorkConfig = getParallelWorkConfig();
        const shouldOpenTerminal = options.open !== false && parallelWorkConfig.openTerminal;

        if (shouldOpenTerminal) {
            console.log(chalk.dim('Opening terminal...'));
            const modeOverride = getTerminalModeOverride(options);
            const result = await openParallelWorkTerminal(
                worktreePath,
                issueNumber,
                issueTitle,
                directive,
                modeOverride
            );

            if (result.success) {
                console.log(chalk.green('✓'), 'Opened new terminal with Claude');
            } else {
                console.log(chalk.yellow('⚠'), 'Could not open terminal:', result.error);
                console.log(chalk.dim('Run manually:'), `cd ${worktreePath} && claude`);
                // Output spawn directive as fallback
                console.log();
                console.log('[GHP_SPAWN_DIRECTIVE]');
                console.log(JSON.stringify(directive, null, 2));
                console.log('[/GHP_SPAWN_DIRECTIVE]');
            }
        } else {
            // --no-open flag: output spawn directive for scripting/automation
            console.log(chalk.dim('Run:'), `cd ${worktreePath}`);
            console.log();
            console.log('[GHP_SPAWN_DIRECTIVE]');
            console.log(JSON.stringify(directive, null, 2));
            console.log('[/GHP_SPAWN_DIRECTIVE]');
        }
    }
}

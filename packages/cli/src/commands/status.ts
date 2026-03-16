/**
 * ghp status — unified view of pipeline + agents.
 *
 * Merges the pipeline registry (per-worktree stage) with the agent registry
 * (live process info). The --json flag outputs a machine-readable format for
 * slash commands and the dashboard to consume.
 */

import chalk from 'chalk';
import { getMainWorktreeRoot } from '../git-utils.js';
import {
    getAllPipelineEntries,
    getReadyWorktrees,
    getIntegrationTriggerStage,
    isAtOrPastIntegration,
    type PipelineEntry,
} from '../pipeline-registry.js';
import { getAgentSummaries, type AgentSummary } from '@bretwardjames/ghp-core';
import { readSwapState } from './worktree-swap-state.js';
import { exit } from '../exit.js';

export interface StatusEntry {
    // Identity
    issueNumber: number;
    issueTitle: string;
    branch: string;
    worktreePath: string;

    // Pipeline
    stage: string;
    stageEnteredAt: string;
    registeredAt: string;

    // Swap
    inMainRepo: boolean;

    // Agent (null when no agent running)
    agentStatus?: string;
    waitingForInput?: boolean;
    currentAction?: string;
    uptime?: string;
    port?: number;
}

interface StatusOptions {
    json?: boolean;
}

export async function statusCommand(options: StatusOptions = {}): Promise<void> {
    const repoRoot = await getMainWorktreeRoot();
    if (!repoRoot) {
        console.error(chalk.red('Error:'), 'Could not determine repository root');
        exit(1);
        return;
    }

    const pipeline = getAllPipelineEntries(repoRoot);
    const agents = getAgentSummaries();
    const swapState = readSwapState(repoRoot);

    // Build agent lookup by issue number
    const agentByIssue = new Map<number, AgentSummary>();
    for (const agent of agents) {
        agentByIssue.set(agent.issueNumber, agent);
    }

    const entries: StatusEntry[] = pipeline.map(p => {
        const agent = agentByIssue.get(p.issueNumber);
        const inMainRepo = swapState?.worktreeBranch === p.branch;

        return {
            issueNumber: p.issueNumber,
            issueTitle: p.issueTitle,
            branch: p.branch,
            worktreePath: p.worktreePath,
            stage: p.stage,
            stageEnteredAt: p.stageEnteredAt,
            registeredAt: p.registeredAt,
            inMainRepo,
            agentStatus: agent?.status,
            waitingForInput: agent?.waitingForInput,
            currentAction: agent?.currentAction,
            uptime: agent?.uptime,
            port: agent?.port,
        };
    });

    if (options.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
    }

    if (entries.length === 0) {
        console.log(chalk.dim('No worktrees in pipeline.'));
        console.log(chalk.dim('Start a parallel worktree with: ghp start <issue> --parallel'));
        return;
    }

    // Group by bucket
    const triggerStage = getIntegrationTriggerStage();
    const waiting = entries.filter(e => e.waitingForInput);
    const ready   = entries.filter(e => e.stage === triggerStage && !e.inMainRepo);
    const testing = entries.filter(e => e.inMainRepo);
    const working = entries.filter(e =>
        !e.waitingForInput &&
        e.stage !== triggerStage &&
        !e.inMainRepo
    );

    const printBucket = (label: string, color: (s: string) => string, items: StatusEntry[]) => {
        if (items.length === 0) return;
        console.log(color(label));
        for (const e of items) {
            const stage = chalk.dim(e.stage);
            const agent = e.agentStatus ? ` · ${e.agentStatus}` : '';
            const time = e.uptime ? chalk.dim(` · ${e.uptime}`) : '';
            console.log(`  ${chalk.cyan(`#${e.issueNumber}`)}  ${e.issueTitle.substring(0, 40).padEnd(40)}  ${stage}${agent}${time}`);
            if (e.currentAction) {
                console.log(`       ${chalk.dim(`└─ ${e.currentAction}`)}`);
            }
        }
        console.log();
    };

    console.log();
    printBucket('⚠  Needs Attention', chalk.yellow, waiting);
    printBucket('✓  Ready for Integration', chalk.green, ready);
    printBucket('⟳  In Testing (main repo)', chalk.blue, testing);
    printBucket('●  Working', chalk.white, working);

    const readyCount = ready.length;
    if (readyCount > 0) {
        console.log(`Run ${chalk.cyan('ghp wt next')} to swap in the next ready worktree.`);
    }
}

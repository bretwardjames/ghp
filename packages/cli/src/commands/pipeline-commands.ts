/**
 * Pipeline stage management commands.
 *
 * ghp pipeline advance [issue]  — advance to next stage
 * ghp pipeline set <stage> [issue]  — jump to specific stage
 * ghp pipeline stages  — list configured stages
 */

import chalk from 'chalk';
import { execFileSync } from 'child_process';
import { getMainWorktreeRoot } from '../git-utils.js';
import {
    advanceWorktreeStage,
    setWorktreeStage,
    getPipelineEntry,
    getPipelineStages,
    getIntegrationTriggerStage,
    getStageEmoji,
} from '../pipeline-registry.js';
import { exit } from '../exit.js';

function extractIssueFromBranch(branch: string): number | null {
    const match = branch.match(/\/(\d+)-/);
    return match ? parseInt(match[1], 10) : null;
}

async function resolveIssueNumber(issueArg?: string): Promise<number | null> {
    if (issueArg) {
        const num = parseInt(issueArg, 10);
        return isNaN(num) ? null : num;
    }
    // Auto-detect from current branch
    try {
        const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf-8' }).trim();
        return extractIssueFromBranch(branch);
    } catch {
        return null;
    }
}

export async function pipelineAdvanceCommand(issueArg?: string): Promise<void> {
    const repoRoot = await getMainWorktreeRoot();
    if (!repoRoot) {
        console.error(chalk.red('Error:'), 'Could not determine repository root');
        exit(1);
        return;
    }

    const issueNumber = await resolveIssueNumber(issueArg);
    if (!issueNumber) {
        console.error(chalk.red('Error:'), 'Could not determine issue number. Pass it explicitly: ghp pipeline advance <issue>');
        exit(1);
        return;
    }

    const before = getPipelineEntry(repoRoot, issueNumber);
    if (!before) {
        console.error(chalk.red('Error:'), `Issue #${issueNumber} is not in the pipeline.`);
        exit(1);
        return;
    }

    const after = advanceWorktreeStage(repoRoot, issueNumber);
    if (!after || after.stage === before.stage) {
        console.log(chalk.yellow('Already at last stage:'), chalk.dim(before.stage));
        return;
    }

    console.log(chalk.green('✓'), `#${issueNumber}: ${chalk.dim(before.stage)} → ${chalk.cyan(after.stage)}`);
}

export async function pipelineSetCommand(stage: string, issueArg?: string): Promise<void> {
    const repoRoot = await getMainWorktreeRoot();
    if (!repoRoot) {
        console.error(chalk.red('Error:'), 'Could not determine repository root');
        exit(1);
        return;
    }

    const issueNumber = await resolveIssueNumber(issueArg);
    if (!issueNumber) {
        console.error(chalk.red('Error:'), 'Could not determine issue number. Pass it explicitly: ghp pipeline set <stage> <issue>');
        exit(1);
        return;
    }

    const stages = getPipelineStages();
    if (!stages.includes(stage) && stage !== 'needs_attention') {
        console.error(chalk.red('Error:'), `Unknown stage: ${stage}`);
        console.error('Available stages:', stages.join(', ') + ', needs_attention');
        exit(1);
        return;
    }

    const entry = setWorktreeStage(repoRoot, issueNumber, stage);
    if (!entry) {
        console.error(chalk.red('Error:'), `Issue #${issueNumber} is not in the pipeline.`);
        exit(1);
        return;
    }

    console.log(chalk.green('✓'), `#${issueNumber} → ${chalk.cyan(stage)}`);
}

export async function pipelineStagesCommand(): Promise<void> {
    const stages = getPipelineStages();
    const triggerStage = getIntegrationTriggerStage();

    console.log(chalk.bold('Pipeline Stages'));
    console.log();
    for (let i = 0; i < stages.length; i++) {
        const name = stages[i];
        const emoji = getStageEmoji(name);
        const prefix = emoji ? `${emoji} ` : '  ';
        const marker = name === triggerStage ? chalk.green(' ← integration trigger') : '';
        console.log(`  ${chalk.dim(`${i + 1}.`)} ${prefix}${name}${marker}`);
    }
    console.log();
    console.log(`     ${getStageEmoji('needs_attention')} needs_attention${chalk.yellow(' (non-linear — enter from any stage, advance to resume)')}`);
    console.log();
    console.log(chalk.dim('Configure with: ghp config pipeline.stages \'["stage1", "stage2", ...]\''));
    console.log(chalk.dim('Integration trigger: ghp config pipeline.integrationAfter "<stage>"'));
}

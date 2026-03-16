/**
 * ghp pipeline setup — Agent-friendly setup wizard for pipeline configuration.
 *
 * Three modes:
 *   --questions         Output JSON question schema (no side effects)
 *   --apply             Read answers JSON from stdin, write config + hook scripts
 *   (no flags)          Interactive CLI wizard
 *
 * Flavors (saved presets):
 *   --save <name>       Save answers from stdin as a named flavor
 *   --flavor <name>     Load and apply a saved flavor
 *   --flavors           List saved flavors
 *   --delete-flavor <n> Delete a saved flavor
 */

import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import {
    setConfigByPath,
    getUserConfigPath,
    type ConfigScope,
} from '../config.js';
import {
    isInteractive,
    promptSelect,
    promptWithDefault,
    confirmWithDefault,
} from '../prompts.js';
import { getMainWorktreeRoot } from '../git-utils.js';
import { exit } from '../exit.js';

// ─────────────────────────────────────────────────────────────────────────────
// Question schema
// ─────────────────────────────────────────────────────────────────────────────

interface QuestionOption {
    value: string;
    label: string;
    description?: string;
}

interface Question {
    id: string;
    question: string;
    type: 'select' | 'confirm' | 'text';
    options?: QuestionOption[];
    default?: string | boolean;
    dependsOn?: Record<string, string | boolean>;
    hint?: string;
}

const QUESTIONS: Question[] = [
    // ── General config ──────────────────────────────────────────────────────
    {
        id: 'config_scope',
        question: 'Where should this configuration be saved?',
        type: 'select',
        options: [
            { value: 'workspace', label: 'This project only (.ghp/config.json)', description: 'Checked into the repo — the whole team gets this config' },
            { value: 'user', label: 'Global (~/.config/ghp-cli/config.json)', description: 'Your personal preference across all projects' },
        ],
        default: 'user',
    },
    {
        id: 'save_flavor',
        question: 'Also save these answers as a reusable flavor?',
        type: 'confirm',
        default: false,
        hint: 'Flavors let you reapply this exact setup later with: ghp pipeline setup --flavor <name>',
    },
    {
        id: 'flavor_name',
        question: 'Flavor name:',
        type: 'text',
        default: '',
        dependsOn: { save_flavor: true },
        hint: 'Reapply later with: ghp pipeline setup --flavor <name>',
    },

    // ── Agent spawn mode ─────────────────────────────────────────────────────
    {
        id: 'agent_spawn_mode',
        question: 'How should agents be spawned in tmux?',
        type: 'select',
        options: [
            { value: 'window', label: 'Window (default)', description: 'Each agent gets its own tmux window' },
            { value: 'pane', label: 'Pane', description: 'Split the current tmux window into panes' },
            { value: 'session', label: 'Session', description: 'Each agent gets its own tmux session (nested attach in dashboard viewport)' },
        ],
        default: 'window',
    },
    {
        id: 'tmux_prefix',
        question: 'Tmux naming prefix (used for windows, sessions, admin):',
        type: 'text',
        default: 'ghp',
        hint: 'All tmux names use this prefix (e.g., myproj → myproj-86, myproj-admin). Useful when multiple projects share a tmux server.',
    },

    // ── Dashboard layout ────────────────────────────────────────────────────
    {
        id: 'dashboard_mode',
        question: 'Where should the pipeline dashboard open?',
        type: 'select',
        options: [
            { value: 'pane', label: 'Split pane', description: 'Split the current tmux window' },
            { value: 'window', label: 'New window', description: 'Separate tmux window' },
        ],
        default: 'window',
    },
    {
        id: 'dashboard_direction',
        question: 'When opening as a pane, which direction should it split?',
        type: 'select',
        dependsOn: { dashboard_mode: 'pane' },
        options: [
            { value: 'horizontal', label: 'Side by side' },
            { value: 'vertical', label: 'Stacked (top/bottom)' },
        ],
        default: 'horizontal',
    },
    {
        id: 'dashboard_size',
        question: 'What percentage of space should the dashboard take?',
        type: 'text',
        dependsOn: { dashboard_mode: 'pane' },
        default: '50%',
        hint: 'e.g., 30%, 50%, 40',
    },
    {
        id: 'focused_agent_direction',
        question: 'When you pull an agent into view, where should it appear relative to the dashboard?',
        type: 'select',
        options: [
            { value: 'vertical', label: 'Below the dashboard' },
            { value: 'horizontal', label: 'Beside the dashboard' },
        ],
        default: 'vertical',
    },
    {
        id: 'focused_agent_size',
        question: 'What percentage of space should the focused agent pane take?',
        type: 'text',
        default: '50%',
        hint: 'e.g., 50%, 60%, 70%',
    },

    // ── Pipeline stages ─────────────────────────────────────────────────────
    {
        id: 'custom_stages',
        question: 'Do you want to use custom pipeline stages beyond the defaults (working, stopped)?',
        type: 'confirm',
        default: false,
    },
    {
        id: 'stage_list',
        question: 'List your pipeline stages in order (comma-separated):',
        type: 'text',
        dependsOn: { custom_stages: true },
        default: 'working, stopped',
        hint: 'e.g., planning, working, code_review, pr_submitted, stopped',
    },

    // ── Hook modes ──────────────────────────────────────────────────────────
    {
        id: 'hook_modes',
        question: 'What workflow modes do you want? (comma-separated, leave blank for none)',
        type: 'text',
        default: '',
        hint: 'Modes change which hook scripts run. e.g., "planning, testing, review". When mode is "testing", hooks resolve as .ghp/hooks/<name>.testing before falling back to .ghp/hooks/<name>. Press [m] in the dashboard to cycle modes. Leave blank to skip mode support.',
    },
    {
        id: 'hook_default_mode',
        question: 'Which mode should be active when the dashboard starts?',
        type: 'text',
        default: '',
        hint: 'Must be one of the modes listed above. Leave blank to start with no mode active.',
    },
    {
        id: 'hook_swap_order',
        question: 'When hot-swapping agents, should the old agent\'s hooks run first or the new agent\'s?',
        type: 'select',
        options: [
            { value: 'unfocus-first', label: 'Unfocus first (default)', description: 'Stop old servers before starting new ones — avoids port conflicts' },
            { value: 'focus-first', label: 'Focus first', description: 'Start new servers before stopping old ones — minimizes downtime' },
        ],
        default: 'unfocus-first',
    },

    // ── Directory hooks (.ghp/hooks/<name>) ─────────────────────────────────
    {
        id: 'hook_dashboard_opened',
        question: 'What should happen when the pipeline dashboard opens?',
        type: 'text',
        default: '',
        hint: 'Creates .ghp/hooks/dashboard-opened. Fires when the dashboard starts. Stdin JSON: {"pane_id":"%42","window_name":"ghp-admin"}. Runs from the main repo root. Use this for companion panes (dev servers, log viewers). If modes are configured, mode-specific variants (.ghp/hooks/dashboard-opened.<mode>) will also be scaffolded. Leave blank to skip.',
    },
    {
        id: 'hook_agent_active',
        question: 'What should happen when an agent starts working (PostToolUse)?',
        type: 'text',
        default: '',
        hint: 'Creates .ghp/hooks/agent-active. Fires on Claude Code PostToolUse hook. Stdin: Claude Code hook JSON (includes "cwd"). Runs from the agent\'s cwd. If modes are configured, mode-specific variants will also be scaffolded. Leave blank to skip.',
    },
    {
        id: 'hook_agent_stopped',
        question: 'What should happen when an agent stops?',
        type: 'text',
        default: '',
        hint: 'Creates .ghp/hooks/agent-stopped. Fires on Claude Code Stop hook. Stdin: Claude Code hook JSON (includes "cwd"). Runs from the agent\'s cwd. If modes are configured, mode-specific variants will also be scaffolded. Leave blank to skip.',
    },
    {
        id: 'hook_agent_focused',
        question: 'What should happen when you pull an agent into the dashboard view?',
        type: 'text',
        default: '',
        hint: 'Creates .ghp/hooks/agent-focused. Fires when an agent pane is focused via [1-9] in the dashboard. Stdin JSON: {"issueNumber":123,"worktreePath":"/path/to/worktree","branch":"user/123-feature"}. Runs from the worktree directory. If modes are configured, mode-specific variants will also be scaffolded. Leave blank to skip.',
    },
    {
        id: 'hook_agent_unfocused',
        question: 'What should happen when an agent is released from the dashboard view?',
        type: 'text',
        default: '',
        hint: 'Creates .ghp/hooks/agent-unfocused. Fires when an agent pane is sent back via [esc]. Same stdin payload as agent-focused. Runs from the worktree directory. If modes are configured, mode-specific variants will also be scaffolded. Leave blank to skip.',
    },
    {
        id: 'hook_agent_swapped',
        question: 'What should happen when switching directly between focused agents (hot-swap)?',
        type: 'text',
        default: '',
        hint: 'Creates .ghp/hooks/agent-swapped. Fires when you press [3] while [1] is focused — an atomic swap. Stdin JSON: {"old":{"issueNumber":123,"worktreePath":"/old","branch":"..."},"new":{"issueNumber":456,"worktreePath":"/new","branch":"..."}}. If this hook doesn\'t exist, falls back to sequential unfocus→focus. If modes are configured, mode-specific variants will also be scaffolded. Leave blank to skip.',
    },
    {
        id: 'hook_mode_switched',
        question: 'What should happen when the dashboard hook mode changes (via [m] key)?',
        type: 'text',
        default: '',
        hint: 'Creates .ghp/hooks/mode-switched. Fires when you press [m] to cycle hook modes. Stdin JSON: {"oldMode":"planning","newMode":"testing"} (null = default/no mode). Runs from the main repo root. Unlike other hooks, mode-specific variants are NOT created (this hook IS the mode change notification). Leave blank to skip.',
    },

    // ── Event hooks (registered via ghp hooks add) ──────────────────────────
    {
        id: 'hook_issue_created',
        question: 'What command should run when a new issue is created (ghp add)?',
        type: 'text',
        default: '',
        hint: 'Registers an event hook for "issue-created". Template vars: ${number}, ${title}, ${url}. Example: "echo Issue #${number} created: ${title}". This is an event hook (registered with ghp hooks add --event issue-created), not a directory hook. Leave blank to skip.',
    },
    {
        id: 'hook_issue_started',
        question: 'What command should run when work starts on an issue (ghp start)?',
        type: 'text',
        default: '',
        hint: 'Registers an event hook for "issue-started". Template vars: ${number}, ${branch}, ${worktreePath}. Leave blank to skip.',
    },
    {
        id: 'hook_worktree_created',
        question: 'What command should run after a worktree is created?',
        type: 'text',
        default: '',
        hint: 'Registers an event hook for "worktree-created". Template vars: ${number}, ${worktreePath}, ${branch}. Leave blank to skip.',
    },
    {
        id: 'hook_worktree_removed',
        question: 'What command should run after a worktree is removed?',
        type: 'text',
        default: '',
        hint: 'Registers an event hook for "worktree-removed". Template vars: ${number}, ${worktreePath}, ${branch}. Leave blank to skip.',
    },
    {
        id: 'hook_pre_pr',
        question: 'What command should run before PR creation?',
        type: 'text',
        default: '',
        hint: 'Registers an event hook for "pre-pr". Template vars: ${number}, ${branch}. Runs in blocking mode by default. Leave blank to skip.',
    },
    {
        id: 'hook_pr_created',
        question: 'What command should run after a PR is created?',
        type: 'text',
        default: '',
        hint: 'Registers an event hook for "pr-created". Template vars: ${number}, ${prNumber}, ${prUrl}. Leave blank to skip.',
    },
    {
        id: 'hook_pr_merged',
        question: 'What command should run after a PR is merged?',
        type: 'text',
        default: '',
        hint: 'Registers an event hook for "pr-merged". Template vars: ${number}, ${prNumber}, ${branch}. Leave blank to skip.',
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// Answers type
// ─────────────────────────────────────────────────────────────────────────────

type Answers = Record<string, string | boolean>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Read all of stdin as a string. */
async function readStdin(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        process.stdin.on('data', (chunk) => chunks.push(chunk));
        process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        process.stdin.on('error', reject);
        setTimeout(() => resolve(Buffer.concat(chunks).toString('utf-8')), 3000);
    });
}

/** Check if a question's dependsOn conditions are met. */
function isDependencyMet(question: Question, answers: Answers): boolean {
    if (!question.dependsOn) return true;
    for (const [key, expected] of Object.entries(question.dependsOn)) {
        if (answers[key] !== expected) return false;
    }
    return true;
}

/** Read the raw user config JSON (including non-Config fields like flavors). */
function loadRawUserConfig(): Record<string, unknown> {
    const configPath = getUserConfigPath();
    try {
        if (existsSync(configPath)) {
            return JSON.parse(readFileSync(configPath, 'utf-8'));
        }
    } catch { /* ignore */ }
    return {};
}

/** Write raw user config JSON. */
function saveRawUserConfig(data: Record<string, unknown>): void {
    const configPath = getUserConfigPath();
    const dir = join(configPath, '..');
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(configPath, JSON.stringify(data, null, 2));
}

/** Parse comma-separated string into array, filtering empties. */
function parseCommaSeparated(value: string | boolean | undefined): string[] {
    if (!value || typeof value !== 'string') return [];
    return value.split(',').map(s => s.trim()).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// Flavor CRUD
// ─────────────────────────────────────────────────────────────────────────────

function getFlavors(): Record<string, Answers> {
    const raw = loadRawUserConfig();
    return (raw.pipelineSetupFlavors as Record<string, Answers>) ?? {};
}

function saveFlavor(name: string, answers: Answers): void {
    const raw = loadRawUserConfig();
    const flavors = (raw.pipelineSetupFlavors as Record<string, Answers>) ?? {};
    flavors[name] = answers;
    raw.pipelineSetupFlavors = flavors;
    saveRawUserConfig(raw);
}

function deleteFlavor(name: string): boolean {
    const raw = loadRawUserConfig();
    const flavors = (raw.pipelineSetupFlavors as Record<string, Answers>) ?? {};
    if (!(name in flavors)) return false;
    delete flavors[name];
    raw.pipelineSetupFlavors = flavors;
    saveRawUserConfig(raw);
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Directory hook scaffolding
// ─────────────────────────────────────────────────────────────────────────────

/** Map of directory hook answer IDs to hook script names and templates. */
const DIRECTORY_HOOKS: Record<string, { hookName: string; template: string }> = {
    hook_dashboard_opened: { hookName: 'dashboard-opened', template: DEFAULT_DASHBOARD_OPENED_SCRIPT() },
    hook_agent_active: { hookName: 'agent-active', template: DEFAULT_AGENT_ACTIVE_SCRIPT() },
    hook_agent_stopped: { hookName: 'agent-stopped', template: DEFAULT_AGENT_STOPPED_SCRIPT() },
    hook_agent_focused: { hookName: 'agent-focused', template: DEFAULT_AGENT_FOCUSED_SCRIPT() },
    hook_agent_unfocused: { hookName: 'agent-unfocused', template: DEFAULT_AGENT_UNFOCUSED_SCRIPT() },
    hook_agent_swapped: { hookName: 'agent-swapped', template: DEFAULT_AGENT_SWAPPED_SCRIPT() },
    hook_mode_switched: { hookName: 'mode-switched', template: DEFAULT_MODE_SWITCHED_SCRIPT() },
};

/** Map of event hook answer IDs to event names. */
const EVENT_HOOKS: Record<string, { event: string; defaultMode?: string }> = {
    hook_issue_created: { event: 'issue-created' },
    hook_issue_started: { event: 'issue-started' },
    hook_worktree_created: { event: 'worktree-created' },
    hook_worktree_removed: { event: 'worktree-removed' },
    hook_pre_pr: { event: 'pre-pr', defaultMode: 'blocking' },
    hook_pr_created: { event: 'pr-created' },
    hook_pr_merged: { event: 'pr-merged' },
};

/**
 * Scaffold a directory hook script (and mode-specific variants).
 * Returns array of summary messages.
 */
function scaffoldDirectoryHook(
    hooksDir: string,
    hookName: string,
    template: string,
    description: string,
    modes: string[],
): string[] {
    const summary: string[] = [];

    // Base hook
    const basePath = join(hooksDir, hookName);
    if (existsSync(basePath)) {
        summary.push(`Skipped ${basePath} (already exists)`);
    } else {
        writeFileSync(basePath, template);
        chmodSync(basePath, 0o755);
        summary.push(`Created ${basePath} — ${description}`);
    }

    // Mode-specific variants
    for (const mode of modes) {
        const modePath = join(hooksDir, `${hookName}.${mode}`);
        if (existsSync(modePath)) {
            summary.push(`Skipped ${modePath} (already exists)`);
        } else {
            const modeTemplate = template.replace(
                /^(# Hook: .+)$/m,
                `$1 (mode: ${mode})`
            );
            writeFileSync(modePath, modeTemplate);
            chmodSync(modePath, 0o755);
            summary.push(`Created ${modePath}`);
        }
    }

    return summary;
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply logic
// ─────────────────────────────────────────────────────────────────────────────

async function applyAnswers(answers: Answers): Promise<void> {
    const scope = (answers.config_scope as ConfigScope) || 'user';
    const summary: string[] = [];

    // Save flavor if requested
    if (answers.save_flavor === true && answers.flavor_name && typeof answers.flavor_name === 'string' && answers.flavor_name.trim()) {
        saveFlavor(answers.flavor_name.trim(), answers);
        summary.push(`Saved flavor "${answers.flavor_name.trim()}" — reapply with: ghp pipeline setup --flavor ${answers.flavor_name.trim()}`);
    }

    // Agent spawn mode + tmux prefix
    if (answers.agent_spawn_mode) {
        setConfigByPath('parallelWork.tmux.mode', answers.agent_spawn_mode, scope);
        summary.push(`tmux.mode = ${answers.agent_spawn_mode}`);
    }
    if (answers.tmux_prefix && typeof answers.tmux_prefix === 'string' && answers.tmux_prefix.trim() && answers.tmux_prefix !== 'ghp') {
        const trimmed = answers.tmux_prefix.trim();
        if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
            console.log(chalk.yellow('Warning:'), 'Prefix contains invalid characters — use only letters, numbers, hyphens, and underscores. Skipped.');
        } else {
            setConfigByPath('parallelWork.tmux.prefix', trimmed, scope);
            summary.push(`tmux.prefix = ${trimmed}`);
        }
    }

    // Dashboard config
    if (answers.dashboard_mode) {
        setConfigByPath('parallelWork.dashboard.mode', answers.dashboard_mode, scope);
        summary.push(`dashboard.mode = ${answers.dashboard_mode}`);
    }
    if (answers.dashboard_direction) {
        setConfigByPath('parallelWork.dashboard.direction', answers.dashboard_direction, scope);
        summary.push(`dashboard.direction = ${answers.dashboard_direction}`);
    }
    if (answers.dashboard_size) {
        setConfigByPath('parallelWork.dashboard.size', answers.dashboard_size, scope);
        summary.push(`dashboard.size = ${answers.dashboard_size}`);
    }
    if (answers.focused_agent_direction) {
        setConfigByPath('parallelWork.dashboard.focusedAgent.direction', answers.focused_agent_direction, scope);
        summary.push(`focusedAgent.direction = ${answers.focused_agent_direction}`);
    }
    if (answers.focused_agent_size) {
        setConfigByPath('parallelWork.dashboard.focusedAgent.size', answers.focused_agent_size, scope);
        summary.push(`focusedAgent.size = ${answers.focused_agent_size}`);
    }

    // Pipeline stages
    if (answers.custom_stages === true && answers.stage_list) {
        const stages = parseCommaSeparated(answers.stage_list);
        if (stages.length > 0) {
            setConfigByPath('pipeline.stages', stages, scope);
            summary.push(`pipeline.stages = [${stages.join(', ')}]`);
        }
    }

    // Hook modes config
    const hookModes = parseCommaSeparated(answers.hook_modes);
    if (hookModes.length > 0) {
        setConfigByPath('pipeline.hookModes', hookModes, scope);
        summary.push(`pipeline.hookModes = [${hookModes.join(', ')}]`);
    }
    if (answers.hook_default_mode && typeof answers.hook_default_mode === 'string' && answers.hook_default_mode.trim()) {
        setConfigByPath('pipeline.defaultHookMode', answers.hook_default_mode.trim(), scope);
        summary.push(`pipeline.defaultHookMode = ${answers.hook_default_mode}`);
    }
    if (answers.hook_swap_order && answers.hook_swap_order !== 'unfocus-first') {
        setConfigByPath('pipeline.hookModeSwapOrder', answers.hook_swap_order, scope);
        summary.push(`pipeline.hookModeSwapOrder = ${answers.hook_swap_order}`);
    }

    // Directory hooks
    const repoRoot = await getMainWorktreeRoot();
    if (repoRoot) {
        const hooksDir = join(repoRoot, '.ghp', 'hooks');

        for (const [answerId, { hookName, template }] of Object.entries(DIRECTORY_HOOKS)) {
            const answer = answers[answerId];
            if (answer && typeof answer === 'string' && answer.trim()) {
                if (!existsSync(hooksDir)) {
                    mkdirSync(hooksDir, { recursive: true });
                }
                // mode-switched should never have mode-specific variants (it IS the mode notification)
                const modes = hookName === 'mode-switched' ? [] : hookModes;
                const msgs = scaffoldDirectoryHook(hooksDir, hookName, template, answer.trim(), modes);
                summary.push(...msgs);
            }
        }
    } else if (Object.keys(DIRECTORY_HOOKS).some(id => {
        const a = answers[id];
        return a && typeof a === 'string' && a.trim();
    })) {
        console.error(chalk.yellow('Warning:'), 'Not in a git repository — skipped hook script generation');
    }

    // Event hooks (register via ghp hooks add)
    for (const [answerId, { event, defaultMode }] of Object.entries(EVENT_HOOKS)) {
        const answer = answers[answerId];
        if (answer && typeof answer === 'string' && answer.trim()) {
            const hookName = `setup-${event}`;
            const mode = defaultMode || 'fire-and-forget';
            try {
                const { execFileSync } = await import('child_process');
                execFileSync('ghp', [
                    'hooks', 'add', hookName,
                    '--event', event,
                    '--command', answer.trim(),
                    '--mode', mode,
                ], { stdio: 'pipe' });
                summary.push(`Registered event hook: ${hookName} (${event}) → ${answer.trim().substring(0, 60)}`);
            } catch (err) {
                summary.push(`Failed to register event hook ${hookName}: ${err instanceof Error ? err.message : 'unknown error'}`);
            }
        }
    }

    // Print summary
    console.log();
    console.log(chalk.bold.green('Setup complete!'));
    console.log();
    const scopeLabel = scope === 'workspace' ? '.ghp/config.json' : '~/.config/ghp-cli/config.json';
    console.log(chalk.dim(`Config scope: ${scopeLabel}`));
    console.log();
    for (const line of summary) {
        console.log(`  ${chalk.green('✓')} ${line}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Default hook scripts (scaffolded for devs/agents to customize)
// ─────────────────────────────────────────────────────────────────────────────

function DEFAULT_DASHBOARD_OPENED_SCRIPT(): string {
    return `#!/usr/bin/env bash
# Hook: dashboard-opened
# Runs when the pipeline dashboard opens. Use this to spawn companion panes
# (dev servers, log viewers, test watchers, etc.) alongside the dashboard.
#
# Receives JSON on stdin with these exact keys:
#   { "pane_id": "%42", "window_name": "ghp-admin" }
#
# IMPORTANT: The pane_id is the tmux pane where the dashboard is running.
# All split-window commands should target this pane with -t "$DASHBOARD_PANE".
# This script runs from the main repo root as its working directory.

INPUT=$(cat)
DASHBOARD_PANE=$(echo "$INPUT" | jq -r '.pane_id')

if [ -z "$DASHBOARD_PANE" ] || [ "$DASHBOARD_PANE" = "null" ]; then
  DASHBOARD_PANE=$(tmux display-message -p "#{pane_id}")
fi

# ── Add your companion panes below ──────────────────────────────────────────
# Examples:
#
# Split left of dashboard, run dev server (50% width):
#   DEV=$(tmux split-window -hb -l 50% -t "$DASHBOARD_PANE" -P -F '#{pane_id}' 'pnpm dev')
#   tmux select-pane -t "$DEV" -T 'Dev Server'
#
# Split below dashboard, run tests (30% height):
#   TESTS=$(tmux split-window -v -l 30% -t "$DASHBOARD_PANE" -P -F '#{pane_id}' 'pnpm test --watch')
#   tmux select-pane -t "$TESTS" -T 'Tests'
# ─────────────────────────────────────────────────────────────────────────────

# Refocus the dashboard
tmux select-pane -t "$DASHBOARD_PANE"
`;
}

function DEFAULT_AGENT_ACTIVE_SCRIPT(): string {
    return `#!/usr/bin/env bash
# Hook: agent-active
# Runs when a Claude agent starts working (PostToolUse hook).
# Stdin: Claude Code hook JSON (includes "cwd", "tool_name", etc.)
# This script runs from the agent's cwd.

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd')

# ── Add your actions below ───────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
`;
}

function DEFAULT_AGENT_STOPPED_SCRIPT(): string {
    return `#!/usr/bin/env bash
# Hook: agent-stopped
# Runs when a Claude agent stops (Stop hook).
# Stdin: Claude Code hook JSON (includes "cwd")
# This script runs from the agent's cwd.

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd')

# ── Add your actions below ───────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
`;
}

function DEFAULT_AGENT_FOCUSED_SCRIPT(): string {
    return `#!/usr/bin/env bash
# Hook: agent-focused
# Runs when an agent pane is pulled into the dashboard view (via [1-9] key).
# Use this to show extra context for the focused agent.
#
# Receives JSON on stdin with these exact keys:
#   { "issueNumber": 123, "worktreePath": "/path/to/worktree", "branch": "user/123-feature" }
#
# This script runs from the worktree directory.

INPUT=$(cat)
ISSUE=$(echo "$INPUT" | jq -r '.issueNumber')
WORKTREE=$(echo "$INPUT" | jq -r '.worktreePath')
BRANCH=$(echo "$INPUT" | jq -r '.branch')

# ── Add your focus actions below ─────────────────────────────────────────────
# Examples:
#
# Show git log for this agent's branch:
#   tmux split-window -v -l 20% -t "$TMUX_PANE" "cd '$WORKTREE' && git log --oneline -20"
#
# Tail the agent's conversation log:
#   tmux split-window -v -l 30% -t "$TMUX_PANE" "tail -f '$WORKTREE/.claude/logs/latest.log'"
# ─────────────────────────────────────────────────────────────────────────────
`;
}

function DEFAULT_AGENT_UNFOCUSED_SCRIPT(): string {
    return `#!/usr/bin/env bash
# Hook: agent-unfocused
# Runs when an agent pane is released from the dashboard view (via [esc] key).
# Use this to clean up anything spawned by agent-focused.
#
# Receives JSON on stdin with these exact keys:
#   { "issueNumber": 123, "worktreePath": "/path/to/worktree", "branch": "user/123-feature" }
#
# This script runs from the worktree directory.

INPUT=$(cat)
ISSUE=$(echo "$INPUT" | jq -r '.issueNumber')
WORKTREE=$(echo "$INPUT" | jq -r '.worktreePath')
BRANCH=$(echo "$INPUT" | jq -r '.branch')

# ── Add your cleanup actions below ───────────────────────────────────────────
# Examples:
#
# Kill any extra panes spawned by agent-focused:
#   # (track pane IDs in a temp file from agent-focused, then kill them here)
# ─────────────────────────────────────────────────────────────────────────────
`;
}

function DEFAULT_AGENT_SWAPPED_SCRIPT(): string {
    return `#!/usr/bin/env bash
# Hook: agent-swapped
# Runs when switching directly from one focused agent to another (hot-swap).
# This is an atomic swap — use it to stop old servers and start new ones
# without port conflicts.
#
# Receives JSON on stdin with these exact keys:
#   {
#     "old": { "issueNumber": 123, "worktreePath": "/path/old", "branch": "user/123-feat" },
#     "new": { "issueNumber": 456, "worktreePath": "/path/new", "branch": "user/456-other" }
#   }
#
# If this hook doesn't exist, falls back to sequential unfocus→focus.
# This script runs from the NEW agent's worktree directory.

INPUT=$(cat)
OLD_ISSUE=$(echo "$INPUT" | jq -r '.old.issueNumber')
OLD_WORKTREE=$(echo "$INPUT" | jq -r '.old.worktreePath')
OLD_BRANCH=$(echo "$INPUT" | jq -r '.old.branch')
NEW_ISSUE=$(echo "$INPUT" | jq -r '.new.issueNumber')
NEW_WORKTREE=$(echo "$INPUT" | jq -r '.new.worktreePath')
NEW_BRANCH=$(echo "$INPUT" | jq -r '.new.branch')

# ── Add your swap actions below ──────────────────────────────────────────────
# Examples:
#
# Stop old dev server, start new one:
#   kill $(cat "$OLD_WORKTREE/.dev-server.pid") 2>/dev/null
#   cd "$NEW_WORKTREE" && pnpm dev &
#   echo $! > "$NEW_WORKTREE/.dev-server.pid"
# ─────────────────────────────────────────────────────────────────────────────
`;
}

function DEFAULT_MODE_SWITCHED_SCRIPT(): string {
    return `#!/usr/bin/env bash
# Hook: mode-switched
# Runs when the dashboard hook mode changes (via [m] key).
# Use this to start/stop dev servers, swap tmux layouts, toggle test watchers, etc.
#
# Receives JSON on stdin with these exact keys:
#   { "oldMode": "planning", "newMode": "testing" }
#
# null means "default" (no mode active).
# This script runs from the main repo root as its working directory.
# NOTE: Mode-specific variants of this hook are NOT created — this hook
# IS the mode change notification.

INPUT=$(cat)
OLD_MODE=$(echo "$INPUT" | jq -r '.oldMode // "null"')
NEW_MODE=$(echo "$INPUT" | jq -r '.newMode // "null"')

# ── Add your mode-switch actions below ────────────────────────────────────────
# Examples:
#
# Start test watcher when entering testing mode:
#   if [ "$NEW_MODE" = "testing" ]; then
#     pnpm test --watch &
#   fi
#
# Stop dev server when leaving planning mode:
#   if [ "$OLD_MODE" = "planning" ]; then
#     kill $(cat .dev-server.pid) 2>/dev/null
#   fi
# ─────────────────────────────────────────────────────────────────────────────
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactive wizard
// ─────────────────────────────────────────────────────────────────────────────

async function runInteractiveWizard(): Promise<Answers> {
    const answers: Answers = {};

    console.log(chalk.bold('Pipeline Setup Wizard'));
    console.log(chalk.dim('Configure your pipeline dashboard.\n'));

    for (const q of QUESTIONS) {
        if (!isDependencyMet(q, answers)) continue;

        if (q.type === 'select' && q.options) {
            const optionLabels = q.options.map(o =>
                o.description ? `${o.label} ${chalk.dim(`— ${o.description}`)}` : o.label
            );
            const defaultIdx = q.options.findIndex(o => o.value === q.default);
            const idx = await promptSelect(chalk.bold(q.question), optionLabels);
            answers[q.id] = q.options[idx >= 0 ? idx : (defaultIdx >= 0 ? defaultIdx : 0)].value;
            console.log();
        } else if (q.type === 'confirm') {
            const defaultVal = q.default === true;
            const result = await confirmWithDefault(chalk.bold(q.question), defaultVal);
            answers[q.id] = result;
            console.log();
        } else if (q.type === 'text') {
            const defaultVal = (q.default as string) || '';
            if (q.hint) console.log(chalk.dim(`  ${q.hint}`));
            const val = await promptWithDefault(`${chalk.bold(q.question)} [${defaultVal}] `, defaultVal);
            answers[q.id] = val || defaultVal;
            console.log();
        }
    }

    return answers;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main command
// ─────────────────────────────────────────────────────────────────────────────

export async function pipelineSetupCommand(options: {
    questions?: boolean;
    apply?: boolean;
    save?: string;
    flavor?: string;
    flavors?: boolean;
    deleteFlavor?: string;
}): Promise<void> {
    // ── --questions: output schema ───────────────────────────────────────────
    if (options.questions) {
        console.log(JSON.stringify(QUESTIONS, null, 2));
        return;
    }

    // ── --flavors: list saved flavors ────────────────────────────────────────
    if (options.flavors) {
        const flavors = getFlavors();
        const names = Object.keys(flavors);
        if (names.length === 0) {
            console.log(chalk.dim('No saved flavors.'));
            console.log(chalk.dim('Save one with: echo \'{"answers":"..."}\' | ghp pipeline setup --save <name>'));
            return;
        }
        console.log(chalk.bold('Saved flavors:'));
        for (const name of names) {
            const flavor = flavors[name];
            const mode = flavor.dashboard_mode || 'default';
            console.log(`  ${chalk.cyan(name)} ${chalk.dim(`— dashboard: ${mode}`)}`);
        }
        return;
    }

    // ── --delete-flavor <name> ───────────────────────────────────────────────
    if (options.deleteFlavor) {
        if (deleteFlavor(options.deleteFlavor)) {
            console.log(chalk.green('✓'), `Deleted flavor "${options.deleteFlavor}"`);
        } else {
            console.error(chalk.red('Error:'), `Flavor "${options.deleteFlavor}" not found`);
            exit(1);
        }
        return;
    }

    // ── --save <name>: save answers from stdin as a flavor ───────────────────
    if (options.save) {
        let answers: Answers;
        try {
            const input = await readStdin();
            answers = JSON.parse(input.trim());
        } catch {
            console.error(chalk.red('Error:'), 'Could not parse JSON from stdin');
            exit(1);
            return;
        }
        saveFlavor(options.save, answers);
        console.log(chalk.green('✓'), `Saved flavor "${options.save}"`);
        return;
    }

    // ── --flavor <name>: load and apply a saved flavor ───────────────────────
    if (options.flavor) {
        const flavors = getFlavors();
        const answers = flavors[options.flavor];
        if (!answers) {
            console.error(chalk.red('Error:'), `Flavor "${options.flavor}" not found`);
            console.error('Available flavors:', Object.keys(flavors).join(', ') || '(none)');
            exit(1);
            return;
        }
        console.log(chalk.dim(`Applying flavor "${options.flavor}"...`));
        await applyAnswers(answers);
        return;
    }

    // ── --apply: read answers from stdin and apply ───────────────────────────
    if (options.apply) {
        let answers: Answers;
        try {
            const input = await readStdin();
            answers = JSON.parse(input.trim());
        } catch {
            console.error(chalk.red('Error:'), 'Could not parse JSON from stdin');
            exit(1);
            return;
        }
        await applyAnswers(answers);
        return;
    }

    // ── Interactive wizard (no flags) ────────────────────────────────────────
    if (!isInteractive()) {
        console.error(chalk.red('Error:'), 'Interactive mode requires a TTY. Use --questions/--apply for non-interactive use.');
        exit(1);
        return;
    }

    const answers = await runInteractiveWizard();
    await applyAnswers(answers);
}

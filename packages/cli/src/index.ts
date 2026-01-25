#!/usr/bin/env node

import { Command } from 'commander';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
import { workCommand } from './commands/work.js';
import { planCommand } from './commands/plan.js';
import { startCommand } from './commands/start.js';
import { doneCommand } from './commands/done.js';
import { moveCommand } from './commands/move.js';
import { switchCommand } from './commands/switch.js';
import { linkBranchCommand } from './commands/link-branch.js';
import { unlinkBranchCommand } from './commands/unlink-branch.js';
import { prCommand } from './commands/pr.js';
import { assignCommand } from './commands/assign.js';
import { labelCommand } from './commands/label.js';
import { authCommand } from './commands/auth.js';
import { configCommand } from './commands/config.js';
import { addIssueCommand } from './commands/add-issue.js';
import { setFieldCommand } from './commands/set-field.js';
import { sliceCommand } from './commands/slice.js';
import { openCommand } from './commands/open.js';
import { commentCommand } from './commands/comment.js';
import { syncCommand } from './commands/sync.js';
import { editCommand } from './commands/edit.js';
import { mcpCommand } from './commands/mcp.js';
import { installCommandsCommand } from './commands/install-commands.js';
import { worktreeRemoveCommand, worktreeListCommand } from './commands/worktree.js';
import { planEpicCommand } from './commands/plan-epic.js';
import { setParentCommand } from './commands/set-parent.js';
import { agentsListCommand, agentsStopCommand, agentsWatchCommand } from './commands/agents.js';
import { progressCommand } from './commands/progress.js';
import { dashboardCommand } from './commands/dashboard.js';

const program = new Command();

program
    .name('ghp')
    .description('GitHub Projects CLI - manage project boards from your terminal')
    .version(pkg.version);

// Authentication
program
    .command('auth')
    .description('Authenticate with GitHub')
    .option('--status', 'Check authentication status')
    .action(authCommand);

// Configuration
program
    .command('config')
    .description('View or set configuration (supports dotted paths like mcp.tools.workflows)')
    .argument('[key]', 'Config key or dotted path to get/set (e.g., mcp.tools.workflows)')
    .argument('[value]', 'Value to set')
    .option('-s, --show', 'Show config (use with -w/-u to filter by scope, add key for section)')
    .option('-e, --edit', 'Open config file in editor (explicit)')
    .option('-w, --workspace', 'Target workspace config (.ghp/config.json)')
    .option('-u, --user', 'Target user config (~/.config/ghp-cli/config.json)')
    .option('--disable-tool <name>', 'Add a tool to mcp.disabledTools')
    .option('--enable-tool <name>', 'Remove a tool from mcp.disabledTools')
    .action(configCommand);

// AI-powered commands
program
    .command('plan-epic <title>')
    .alias('pe')
    .description('Use AI to break down an epic into actionable issues')
    .option('-p, --project <project>', 'Target project')
    .option('-x, --execute', 'Execute plan (create issues)')
    .option('--dry-run', 'Show what would be created without creating')
    .option('-c, --context <context>', 'Additional context for planning')
    .action(planEpicCommand);

// Main views
program
    .command('work')
    .alias('w')
    .description('Show items assigned to you (sidebar view)')
    .option('-a, --all', 'Show all items, not just assigned to me')
    .option('-s, --status <status>', 'Filter by status')
    .option('--hide-done', 'Hide completed items')
    .option('-l, --list', 'Output as simple list (one item per line, for pickers)')
    .option('-f, --flat', 'Output as flat table instead of grouped by status')
    .option('-g, --group <field>', 'Group items by field (status, type, assignee, priority, size, labels)')
    .option('--sort <fields>', 'Sort by fields (comma-separated, prefix with - for ascending)')
    .option('--slice <field=value>', 'Filter by field (repeatable)', (val: string, acc: string[]) => { acc.push(val); return acc; }, [])
    .option('-F, --filter <field=value>', 'Filter by field (repeatable, e.g., --filter state=open)', (val: string, acc: string[]) => { acc.push(val); return acc; }, [])
    .action(workCommand);

program
    .command('plan [shortcut]')
    .alias('p')
    .description('Show project board or filtered list view (use shortcut name from config)')
    .option('-p, --project <project>', 'Filter by project name')
    .option('-s, --status <status>', 'Show only items in this status (list view)')
    .option('-a, --all', 'Show all items in table view (overrides board view)')
    .option('-m, --mine', 'Show only items assigned to me')
    .option('-u, --unassigned', 'Show only unassigned items')
    .option('-l, --list', 'Output as table view')
    .option('-g, --group <field>', 'Group items by field (status, type, assignee, priority, size, labels)')
    .option('--sort <fields>', 'Sort by fields (comma-separated, prefix with - for ascending, e.g., "status,-title")')
    .option('--slice <field=value>', 'Filter by field (repeatable: --slice label=bug --slice Priority=High)', (val: string, acc: string[]) => { acc.push(val); return acc; }, [])
    .option('--view <name>', 'Filter to items in a specific project view')
    .action(planCommand);

program
    .command('progress')
    .alias('pg')
    .description('Show feature progress grouped by epic (parent issues with sub-issues)')
    .option('-p, --project <project>', 'Filter by project name')
    .option('-t, --type <type>', 'Filter parent issues by type (e.g., Epic)')
    .option('-a, --all', 'Show all sub-issues (default: collapse if >10)')
    .action(progressCommand);

program
    .command('dashboard')
    .alias('db')
    .description('Show comprehensive view of branch changes (commits, files, diff)')
    .option('--diff', 'Include full diff output')
    .option('--stats', 'Show only diff statistics')
    .option('--commits', 'Show only commit history')
    .option('--files', 'Show only changed files')
    .option('--base <branch>', 'Base branch to compare against (default: main)')
    .option('--max-diff-lines <n>', 'Maximum diff lines to show (default: 500)', parseInt)
    .action(dashboardCommand);

// Workflow commands
program
    .command('start <issue>')
    .alias('s')
    .description('Start working on an issue - creates branch and updates status')
    .option('--no-branch', 'Skip branch creation')
    .option('--no-status', 'Skip status update')
    // Parallel work mode
    .option('--parallel', 'Create worktree and open new terminal (work in parallel)')
    .option('--no-open', 'Skip opening terminal (with --parallel, just create worktree)')
    .option('--worktree-path <path>', 'Custom path for parallel worktree')
    // Terminal mode overrides (for use with --parallel)
    .option('--nvim', 'Use nvim with claudecode.nvim plugin (overrides config)')
    .option('--claude', 'Use claude CLI directly (overrides config)')
    .option('--terminal-only', 'Just open terminal, no Claude (overrides config)')
    // Non-interactive flags
    .option('--assign <action>', 'Handle assignment: reassign, add, or skip')
    .option('--branch-action <action>', 'Branch action: create, link, or skip')
    .option('--from-main', 'Always switch to main before creating branch')
    .option('-fd, --force-defaults', 'Use default values for all prompts (non-interactive mode)')
    .option('--force', 'Proceed despite uncommitted changes')
    .action(startCommand);

program
    .command('done <issue>')
    .alias('d')
    .description('Mark an issue as done')
    .action(doneCommand);

program
    .command('move <issue> <status>')
    .alias('m')
    .description('Move an issue to a different status')
    .action(moveCommand);

// Branch commands
program
    .command('switch <issue>')
    .alias('sw')
    .description('Switch to the branch linked to an issue')
    .option('--parallel', 'Create worktree and open new terminal (work in parallel)')
    .option('--no-open', 'Skip opening terminal (with --parallel, just create worktree)')
    .option('--worktree-path <path>', 'Custom path for parallel worktree')
    // Terminal mode overrides (for use with --parallel)
    .option('--nvim', 'Use nvim with claudecode.nvim plugin (overrides config)')
    .option('--claude', 'Use claude CLI directly (overrides config)')
    .option('--terminal-only', 'Just open terminal, no Claude (overrides config)')
    .action(switchCommand);

program
    .command('link-branch <issue> [branch]')
    .alias('lb')
    .description('Link a branch to an issue (defaults to current branch)')
    .action(linkBranchCommand);

program
    .command('unlink-branch <issue>')
    .alias('ub')
    .description('Unlink the branch from an issue')
    .action(unlinkBranchCommand);

// PR workflow
program
    .command('pr [issue]')
    .description('Create or view PR for an issue')
    .option('--create', 'Create a new PR')
    .option('--open', 'Open PR in browser')
    .option('--ai-description', 'Generate PR description using AI (follows CLAUDE.md conventions)')
    .action(prCommand);

// Assignment
program
    .command('assign <issue> [users...]')
    .description('Assign users to an issue (empty to assign self)')
    .option('--remove', 'Remove assignment instead of adding')
    .action(assignCommand);

// Labels
program
    .command('label <issue> <labels...>')
    .description('Add or remove labels from an issue')
    .option('--remove', 'Remove labels instead of adding')
    .action(labelCommand);

// Issue creation
program
    .command('add-issue [title]')
    .alias('add')
    .description('Create a new issue and add to project')
    .option('-b, --body <body>', 'Issue body/description')
    .option('-p, --project <project>', 'Project to add to (defaults to first)')
    .option('-s, --status <status>', 'Initial status')
    .option('-e, --edit', 'Open $EDITOR to write issue body')
    .option('-t, --template <name>', 'Use an issue template from .github/ISSUE_TEMPLATE/')
    .option('--list-templates', 'List available issue templates')
    .option('--ai', 'Expand brief title into full issue using AI')
    .option('--parent <issue>', 'Set parent issue number (links as sub-issue)')
    .option('-l, --labels <labels>', 'Labels to apply (comma-separated)')
    .option('-a, --assign [users]', 'Assign users (comma-separated, empty for self)')
    .option('-F, --field <field=value>', 'Set project field (repeatable)', (val: string, acc: string[]) => { acc.push(val); return acc; }, [])
    // Non-interactive flags
    .option('--no-template', 'Skip template selection (blank issue)')
    .option('-fd, --force-defaults', 'Use default values for all prompts (non-interactive mode)')
    .action(addIssueCommand);

// Parent/child relationships
program
    .command('set-parent <issue>')
    .description('Set or remove parent issue (sub-issue relationship)')
    .option('-p, --parent <issue>', 'Parent issue number')
    .option('--remove', 'Remove current parent')
    .action(setParentCommand);

// Field management
program
    .command('set-field <issue> <field> <value>')
    .alias('sf')
    .description('Set a field value on an issue')
    .action(setFieldCommand);

// Filtering/slicing
program
    .command('slice')
    .description('Filter items by field values (interactive)')
    .option('-f, --field <field>', 'Field to filter by')
    .option('-v, --value <value>', 'Value to filter for')
    .option('--list-fields', 'List available fields')
    .action(sliceCommand);

// Quick access
program
    .command('open <issue>')
    .alias('o')
    .description('View issue details')
    .option('-b, --browser', 'Open in browser instead of terminal')
    .action(openCommand);

program
    .command('comment <issue>')
    .alias('c')
    .description('Add a comment to an issue')
    .option('-m, --message <text>', 'Comment text (opens editor if not provided)')
    .action(commentCommand);

program
    .command('edit <issue>')
    .alias('e')
    .description('Edit an issue description in $EDITOR')
    .action(editCommand);

// Active label sync
program
    .command('sync')
    .description('Sync active label to match current branch')
    .action(syncCommand);

// MCP server configuration
program
    .command('mcp')
    .description('Configure ghp MCP server for Claude Desktop')
    .option('-c, --config', 'Show the MCP configuration JSON')
    .option('-i, --install', 'Auto-configure Claude Desktop')
    .option('--install-claude-commands', 'Also install Claude slash commands (use with --install)')
    .option('-s, --status', 'Show enabled/disabled MCP tools')
    .action(mcpCommand);

// Slash command installation
program
    .command('install-commands')
    .description('Install bundled slash commands for AI assistants')
    .option('--claude', 'Install commands for Claude Code')
    .option('--only <commands>', 'Install only specific commands (comma-separated)')
    .option('-f, --force', 'Overwrite existing command files')
    .option('-n, --namespace <prefix>', 'Namespace prefix for commands (default: ghp)')
    .action(installCommandsCommand);

// Worktree management
const worktreeCmd = program
    .command('worktree')
    .alias('wt')
    .description('Manage parallel worktrees');

worktreeCmd
    .command('remove <issue>')
    .alias('rm')
    .description('Remove worktree for an issue')
    .option('-f, --force', 'Force removal even with uncommitted changes')
    .action(worktreeRemoveCommand);

worktreeCmd
    .command('list')
    .alias('ls')
    .description('List all worktrees')
    .action(worktreeListCommand);

// Agent management
const agentsCmd = program
    .command('agents')
    .alias('ag')
    .description('Manage parallel Claude agents');

agentsCmd
    .command('list')
    .alias('ls')
    .description('List all running agents')
    .action(agentsListCommand);

agentsCmd
    .command('stop [issue]')
    .description('Stop an agent (by issue number) or all agents')
    .option('-f, --force', 'Skip confirmation')
    .option('-a, --all', 'Stop all agents')
    .action(agentsStopCommand);

agentsCmd
    .command('watch')
    .alias('w')
    .description('Watch agents with auto-refresh (simple dashboard)')
    .option('-i, --interval <seconds>', 'Refresh interval in seconds', '2')
    .action(agentsWatchCommand);

program.parse();

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
import { authCommand } from './commands/auth.js';
import { configCommand } from './commands/config.js';
import { addIssueCommand } from './commands/add-issue.js';
import { setFieldCommand } from './commands/set-field.js';
import { sliceCommand } from './commands/slice.js';
import { openCommand } from './commands/open.js';
import { commentCommand } from './commands/comment.js';
import { syncCommand } from './commands/sync.js';
import { editCommand } from './commands/edit.js';

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
    .description('View or set configuration')
    .argument('[key]', 'Config key to get/set')
    .argument('[value]', 'Value to set')
    .option('-s, --show', 'Show merged config from all sources')
    .option('-e, --edit', 'Open config file in editor (explicit)')
    .option('-w, --workspace', 'Target workspace config (.ghp/config.json)')
    .option('-u, --user', 'Target user config (~/.config/ghp-cli/config.json)')
    .action(configCommand);

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

// Workflow commands
program
    .command('start <issue>')
    .alias('s')
    .description('Start working on an issue - creates branch and updates status')
    .option('--no-branch', 'Skip branch creation')
    .option('--no-status', 'Skip status update')
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
    .action(prCommand);

// Assignment
program
    .command('assign <issue> [users...]')
    .description('Assign users to an issue (empty to assign self)')
    .option('--remove', 'Remove assignment instead of adding')
    .action(assignCommand);

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
    // Non-interactive flags
    .option('--no-template', 'Skip template selection (blank issue)')
    .option('-fd, --force-defaults', 'Use default values for all prompts (non-interactive mode)')
    .action(addIssueCommand);

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

program.parse();

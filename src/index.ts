#!/usr/bin/env node

import { Command } from 'commander';
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

const program = new Command();

program
    .name('ghp')
    .description('GitHub Projects CLI - manage project boards from your terminal')
    .version('0.1.0');

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
    .option('-l, --list', 'List all config values')
    .option('-e, --edit', 'Open config file in editor (creates template if missing)')
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
    .action(workCommand);

program
    .command('plan [shortcut]')
    .alias('p')
    .description('Show project board or filtered list view (use shortcut name from config)')
    .option('-p, --project <project>', 'Filter by project name')
    .option('-s, --status <status>', 'Show only items in this status (list view)')
    .option('-m, --mine', 'Show only items assigned to me')
    .option('-u, --unassigned', 'Show only unassigned items')
    .option('-l, --list', 'Output as simple list (one item per line, for pickers)')
    .option('--sort <fields>', 'Sort by fields (comma-separated, prefix with - for ascending, e.g., "status,-title")')
    .option('--slice <field=value>', 'Filter by field (repeatable: --slice label=bug --slice Priority=High)', (val: string, acc: string[]) => { acc.push(val); return acc; }, [])
    .action(planCommand);

// Workflow commands
program
    .command('start <issue>')
    .alias('s')
    .description('Start working on an issue - creates branch and updates status')
    .option('--no-branch', 'Skip branch creation')
    .option('--no-status', 'Skip status update')
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

program.parse();

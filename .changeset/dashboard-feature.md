---
"@bretwardjames/ghp-core": minor
"@bretwardjames/ghp-cli": minor
---

**Branch Dashboard** - Comprehensive view of branch changes with extensible hook system

- `ghp dashboard` - Show commits, file changes, and diff stats for current branch
- `ghp dashboard --diff` - Show full unified diff
- `ghp dashboard --commits` - Show commit history only
- `ghp dashboard --files` - Show changed files only
- `ghp dashboard --stats` - Show diff statistics only
- `ghp dashboard --json` - Output in JSON format for programmatic use
- `ghp dashboard --base <branch>` - Compare against specific base branch

**Dashboard Hooks** - Extensible system for external content providers

- `ghp dashboard hooks list` - List registered hooks
- `ghp dashboard hooks add <name>` - Register a new hook
- `ghp dashboard hooks remove <name>` - Remove a hook
- `ghp dashboard hooks enable/disable <name>` - Toggle hooks
- `ghp dashboard hooks show <name>` - Show hook details
- Hooks receive `--branch` and `--repo` args, return JSON response
- Hook results displayed in dashboard grouped by category

**VS Code Extension** - Dashboard panel integration

- "Open Dashboard" command to view branch changes in webview
- Tabs for Files Changed, Commits, and Full Diff views
- External Changes section for hook data
- Refresh command to update dashboard data

**Neovim Plugin** - Dashboard buffer with keymaps

- `:GhpDashboard` - Open dashboard in split
- `:GhpDashboardFloat` - Open in floating window
- Buffer keymaps: `<CR>` open file, `d` show diff, `c` commits, `r` refresh, `q` close

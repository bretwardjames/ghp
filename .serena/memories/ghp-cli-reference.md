# GHP CLI Reference

**Always use `ghp` instead of `gh` for GitHub operations in this project.**

## Main Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `ghp auth` | | Authenticate with GitHub |
| `ghp config` | | View or set configuration |
| `ghp plan` | `p` | Show project board or filtered list view |
| `ghp work` | `w` | Show items assigned to you |
| `ghp progress` | `pg` | Show feature progress grouped by epic |
| `ghp start` | `s` | Start working on an issue (creates branch, updates status) |
| `ghp done` | `d` | Mark an issue as done |
| `ghp move` | `m` | Move an issue to a different status |
| `ghp switch` | `sw` | Switch to the branch linked to an issue |
| `ghp open` | `o` | View issue details |
| `ghp comment` | `c` | Add a comment to an issue |
| `ghp edit` | `e` | Edit an issue description in $EDITOR |
| `ghp add-issue` | `add` | Create a new issue and add to project |
| `ghp pr` | | Create or view PR for an issue |
| `ghp assign` | | Assign users to an issue |
| `ghp label` | | Add or remove labels from an issue |
| `ghp set-parent` | | Set or remove parent issue |
| `ghp set-field` | `sf` | Set a field value on an issue |
| `ghp link-branch` | `lb` | Link a branch to an issue |
| `ghp unlink-branch` | `ub` | Unlink the branch from an issue |
| `ghp worktree` | `wt` | Manage parallel worktrees |
| `ghp agents` | `ag` | Manage parallel Claude agents |
| `ghp plan-epic` | `pe` | Use AI to break down an epic |
| `ghp slice` | | Filter items by field values |
| `ghp sync` | | Sync active label to match current branch |
| `ghp mcp` | | Configure ghp MCP server |
| `ghp install-commands` | | Install slash commands for AI assistants |

## Common Workflows

### Starting work on an issue
```bash
ghp start 123                    # Create branch, update status
ghp start 123 --from-main        # Always branch from main
ghp start 123 --parallel         # Create worktree, open new terminal
ghp start 123 -fd                # Force defaults (non-interactive)
ghp start 123 --from-main -fd    # Common combo for parallel work
```

### Creating issues
```bash
ghp add "Issue title"            # Create and add to project
ghp add "Title" --body "desc"    # With body
ghp add "Title" --parent 100     # As sub-issue of #100
ghp add "Title" --ai             # Expand title with AI
ghp add "Title" -e               # Open editor for body
```

### Viewing work
```bash
ghp plan                         # Show board view
ghp plan --mine                  # Only my items
ghp plan --status "In Progress"  # Filter by status
ghp work                         # My assigned items
ghp progress                     # Epic progress view
ghp open 123                     # View issue details
ghp open 123 -b                  # Open in browser
```

### Managing issues
```bash
ghp move 123 "In Progress"       # Change status
ghp done 123                     # Mark as done
ghp comment 123 -m "message"     # Add comment
ghp assign 123                   # Assign to self
ghp label 123 bug enhancement    # Add labels
ghp set-parent 123 --parent 100  # Set parent issue
```

### PR workflow
```bash
ghp pr                           # View current PR status
ghp pr --create                  # Create PR
ghp pr --ai-description          # Create with AI-generated description
ghp pr --open                    # Open PR in browser
```

### Parallel work (worktrees)
```bash
ghp start 123 --parallel         # Create worktree + open terminal
ghp switch 123 --parallel        # Switch to issue's worktree
ghp worktree list                # List all worktrees
ghp worktree remove 123          # Remove worktree for issue
ghp agents list                  # List running Claude agents
ghp agents watch                 # Dashboard of running agents
ghp agents stop 123              # Stop agent for issue
ghp agents stop --all            # Stop all agents
```

### Configuration
```bash
ghp config --show                # Show all config
ghp config --edit                # Edit config file
ghp config project.default X     # Set default project
ghp config -w --show             # Show workspace config
```

## Key Flags

| Flag | Commands | Description |
|------|----------|-------------|
| `--from-main` | start | Branch from main (pulls first) |
| `-fd`, `--force-defaults` | start, add | Non-interactive mode |
| `--parallel` | start, switch | Use worktree + new terminal |
| `--no-open` | start, switch | Create worktree but don't open terminal |
| `--parent <issue>` | add, set-parent | Set parent issue |
| `--mine`, `-m` | plan | Filter to my items |
| `--status`, `-s` | plan, work | Filter by status |
| `--ai` | add | Expand title with AI |
| `--ai-description` | pr | Generate PR description with AI |
| `-b`, `--browser` | open, pr | Open in browser |

## Important Notes

1. **Use `ghp add` not `gh issue create`** - `ghp add` automatically adds to the project
2. **Use `ghp move` to change status** - not manual label changes
3. **Worktrees are per-issue** - one worktree per issue number
4. **Active label** - `@username:active` tracks which issues have active worktrees

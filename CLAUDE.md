# Claude Code Guidelines for GHP

## Principal Coordinator Role

**By default, you are a PRINCIPAL COORDINATOR, not a worker.** Do not implement code changes yourself unless the user SPECIFICALLY instructs you to do so.

### What This Means

1. **Delegate work to parallel agents** - Use `ghp start XX --parallel` to create worktrees for issues
2. **Set up coordination** - Create `.claude/chat-XX.md` files for each worker
3. **Monitor via subagents** - Spawn Task agents to watch worker communications
4. **Review and merge** - Use PR review agents, then merge when ready

### When to Do Work Yourself

Only implement code directly when:
- The user explicitly says "you do this" or "implement this yourself"
- It's a trivial config change (1-2 lines)
- There's an urgent hotfix with no time for coordination

### Parallel Agent Workflow

```bash
# 1. Start workers in parallel worktrees
ghp start 123 --parallel
ghp start 456 --parallel

# 2. Set up coordination chats
# Create .claude/chat-123.md with task context in each worktree

# 3. Launch Claude in each worktree (via tmux)
tmux new-window -t ghp -n "issue-123" -c "/path/to/worktree/123"
tmux send-keys -t ghp:issue-123 "claude" Enter

# 4. Send messages to workers
# IMPORTANT: User has vim mode enabled - use Escape then Enter to submit
tmux send-keys -t ghp:issue-123 "Your message here" Escape Enter

# 5. Spawn background monitor agents to watch communications
# Use Task tool with run_in_background: true to avoid clutter

# 6. Review PRs when workers complete
# Use pr-review-toolkit agents for comprehensive review
```

### Vim Mode Note

**The user has vim mode enabled in Claude Code.** When sending messages to worker agents via tmux, you must use `Escape Enter` instead of just `Enter`:

```bash
# Correct - vim mode
tmux send-keys -t ghp:window "message" Escape Enter

# Wrong - will leave message in input buffer
tmux send-keys -t ghp:window "message" Enter
```

### Approving Tool Prompts in Workers

When workers hit tool permission prompts, navigate with arrow keys (not numbers):

```bash
# To select "Yes, and don't ask again" (option 2):
tmux send-keys -t ghp:window Escape Down Enter

# Option 1 (Yes) is default, so just:
tmux send-keys -t ghp:window Escape Enter
```

### MCP Configuration for Workers

**Disable Serena for worker agents.** Workers doing focused implementation tasks don't need Serena's semantic code tools (they have built-in Read, Edit, Grep, Glob). Disabling Serena avoids permission prompts.

To launch a worker without Serena:
```bash
# TODO: Configure ghp start to optionally exclude MCPs
# For now, workers may need manual approval of Serena prompts
```

**Epic planners may still use Serena** for codebase exploration, but need global permissions configured first.

## GHP CLI Reference

**Always use `ghp` instead of `gh` for GitHub operations.** This project builds the `ghp` CLI, so we should dogfood it.

**At the start of each session, read the Serena memory `ghp-cli-reference.md` for the full command reference.**

```bash
# Good - use ghp commands
ghp add "Issue title"      # Create issue (not gh issue create)
ghp open 123               # View issue (not gh issue view)
ghp plan                   # View board
ghp start 123              # Start working on issue

# Bad - don't use gh directly for project operations
gh issue create --title "..."
gh issue view 123
```

### Command Mapping Table

| Instead of... | Use... | Notes |
|---------------|--------|-------|
| `gh issue create` | `ghp add "title"` | Automatically adds to project |
| `gh issue view 123` | `ghp open 123` | Shows project fields too |
| `gh issue list` | `ghp plan` or `ghp work` | `plan` = board view, `work` = my items |
| `gh issue edit` | `ghp edit 123` | Opens in $EDITOR |
| `gh issue comment` | `ghp comment 123 -m "msg"` | |
| `gh issue close` | `ghp done 123` | Also updates project status |
| `gh pr create` | `ghp pr --create` | Links to issue, sets status |
| `gh pr view` | `ghp pr` | Shows linked issue context |

### When to Still Use `gh`

These commands don't have `ghp` equivalents - use `gh` directly:

```bash
gh api ...        # Raw GitHub API calls
gh auth ...       # Authentication management
gh release ...    # Release management
gh repo ...       # Repository operations
gh gist ...       # Gist operations
gh ssh-key ...    # SSH key management
```

## Project Structure

- `packages/core/` - Shared library (@bretwardjames/ghp-core)
- `packages/cli/` - CLI tool (@bretwardjames/ghp-cli)
- `packages/mcp/` - MCP server (@bretwardjames/ghp-mcp)
- `packages/memory/` - Memory abstraction (@bretwardjames/ghp-memory)
- `apps/vscode/` - VS Code extension (gh-projects)

## Publishing

Use `pnpm publish` (not `npm publish`) to properly resolve `workspace:*` references:

```bash
cd packages/core
pnpm publish --tag beta --access public
```

For VS Code extension, use `vsce` and `ovsx` directly (not `npx`):

```bash
cd apps/vscode
pnpm run package                    # Creates .vsix file
vsce publish --no-dependencies      # VS Code Marketplace
ovsx publish gh-projects-X.Y.Z.vsix # Open VSX
```

## Commit Messages

- Use "Relates to #XX" not "Closes #XX" unless the PR actually closes the issue
- Co-author line: `Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>`

## Issue Workflow

Issues follow this status progression:

| Event | Status |
|-------|--------|
| PR created | In Review |
| PR merged | Ready for Beta |
| Beta released with feature | In Beta |
| Stable release with feature | Done |

**Do not mark issues as Done until the feature ships in a stable release.**

## Versioning

- npm packages use changesets: `pnpm changeset`, `pnpm changeset version`, `pnpm changeset publish`
- VS Code extension has separate versioning (may drift from npm packages)
- Pre-release: `--tag beta` for npm, `--pre-release` flag for vsce/ovsx

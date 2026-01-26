# Claude Code Guidelines for GHP

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

## Commit Messages

- Use "Relates to #XX" not "Closes #XX" unless the PR actually closes the issue
- Co-author line: `Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>`

## Versioning

- npm packages use changesets: `pnpm changeset`, `pnpm changeset version`, `pnpm changeset publish`
- VS Code extension has separate versioning (may drift from npm packages)
- Pre-release: `--tag beta` for npm, `--pre-release` flag for vsce/ovsx

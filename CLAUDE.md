# Claude Code Guidelines for GHP

## CLI Usage

**Always use `ghp` instead of `gh` for GitHub operations.** This project builds the `ghp` CLI, so we should dogfood it:

```bash
# Good
ghp issue list
ghp issue view 123
ghp issue create --title "..."
ghp plan

# Bad - don't use gh directly
gh issue list
gh issue view 123
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

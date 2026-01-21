# Changelog

## 0.2.0-beta.1

### Minor Changes

- Add parallel work mode with git worktrees

  - `ghp start <issue> --parallel` creates worktree instead of switching branches
  - `ghp switch <issue> --parallel` same for switch command
  - `ghp worktree list` and `ghp worktree remove <issue>` commands
  - Automatic worktree setup: copies .env files, runs install command
  - Active label protection for issues with active worktrees
  - VS Code extension support with "Start in Worktree" command
  - Cleanup prompts when marking issues as done

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.2.0-beta.1

## 0.2.0-beta.0

### Minor Changes

- Adds non-interactive support for CLI commands, as well as a full MCP server for configuring AI agents to work directly with the CLI.

### Patch Changes

- Updated dependencies
  - @bretwardjames/ghp-core@0.2.0-beta.0

## [0.1.7] - 2025-01-17

### Added

- **Layered configuration system** - Workspace config (`.ghp/config.json`) for team settings, user config for personal overrides
- **`ghp config sync`** - Import settings from VS Code/Cursor (`ghProjects.*` settings)
- **`ghp config --show`** - Display all settings with source indicators (default/workspace/user)
- **`ghp edit <issue>`** - Edit issue description in $EDITOR

### Changed

- `ghp config` now opens editor by default (use `--show` to view settings)
- `ghp config -w` targets workspace config, `-u` targets user config
- Full config display now shows defaults, shortcuts, and per-shortcut sources

### Fixed

- Handle `status` as array in plan command options

## [0.1.6] - 2025-01-16

### Added

- Branch linking with `ghp link-branch` and `ghp unlink-branch`
- `ghp sync` to sync active label with current branch
- `ghp switch` to switch to linked branch
- Branch column in table display

## [0.1.5] - 2025-01-15

### Added

- Initial release with core commands: work, plan, start, done, move, assign, add-issue, open, comment

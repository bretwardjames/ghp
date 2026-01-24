# Changelog

All notable changes to the "GitHub Projects" extension will be documented in this file.

## [0.3.2] - 2026-01-23

### Added
- **Issue relationships in detail panel** - View parent issue and sub-issues directly in the issue detail panel
- **Epic progress display** - See completion progress for issues with sub-issues
- **Sub-issue indicators** - Visual indicators showing parent/child relationships in sidebar

### Changed
- Issue detail panel now shows relationship hierarchy
- Improved type definitions for issue relationships

## [0.3.1] - 2026-01-22

### Added
- **Parallel Agent Spawning** - Full support for AI-assisted parallel work in Cursor/VS Code
  - Auto-start Claude when opening a worktree in a new window
  - Persistent worktree context (`.ghp/worktree.json`) survives window restarts
  - Manual "Start Claude Session" command when you dismiss the prompt
  - Session resume detection - finds previous Claude sessions and offers to resume
  - Works with Claude Code extension or falls back to integrated terminal
- **Descriptive worktree directory names** - Now uses `271-fix-auth-bug` instead of just `271`
- **New configuration options:**
  - `parallelWork.autoRunClaude` - Auto-start Claude in new windows (default: true)
  - `parallelWork.autoResume` - Detect previous sessions (default: true)
  - `parallelWork.claudeCommand` - Slash command to run (default: `ghp-start`)

### Changed
- Worktree context is now persistent, allowing "Don't Ask Again" to work across sessions
- Extension now activates on startup to detect worktree context

## [0.1.13] - 2026-01-18

### Added
- **Sync Settings with CLI** command - bidirectional settings sync between VS Code and ghp-cli
  - Compare settings and see differences at a glance
  - Choose per-setting which value to keep (VS Code, CLI, or enter custom)
  - Sync settings that only exist in one place to the other
  - Accessible via Command Palette: "GitHub Projects: Sync Settings with CLI"

## [0.1.12] - 2026-01-17

### Added
- Assignment check on Start Working - prompts to reassign/add yourself if not assigned

## [0.1.11] - 2026-01-17

### Fixed
- "Open in GitHub" button now works from sidebar (was broken)
- Renamed from "Open in Browser" to "Open in GitHub"

## [0.1.10] - 2026-01-17

### Added
- **Active item indicator** - Items you're working on (with `@user:active` label) now show:
  - Green icon color in sidebar
  - Circle indicator prefix in description
  - Green left border on cards/list items in Planning Board
  - "🔥 Currently Working On" tooltip header
- **Unified Start Working flow** - Intelligently handles branch linking:
  - If issue has linked branch → switches to it
  - If no linked branch → offers to create new or link existing
  - Branches sorted by relevance (matches issue number/title)
- New setting `ghProjects.showSwitchButton` to optionally hide the separate Switch button

## [0.1.9] - 2026-01-17

### Changed
- Updated README with GHP Tools ecosystem documentation
- Added install script reference and cross-links to ghp-cli

## [0.1.8] - 2026-01-17

### Fixed
- Planning Board list view now correctly applies type, label, and state filters
- Refresh now re-fetches project views to pick up filter changes from GitHub

## [0.1.7] - 2026-01-17

### Changed
- Branch links now stored in GitHub issue bodies (shared with CLI)
- Branch link indicator shows linked branch name in sidebar

## [0.1.3] - 2026-01-16

### Added
- Inline description editing with ✏️ button in issue detail panel
- Markdown rendering for descriptions (headings, lists, bold, italic, code, links)

## [0.1.2] - 2026-01-16

### Fixed
- Changelog updates

## [0.1.1] - 2026-01-15

### Added
- Issue detail panel improvements
- Active label sync functionality

## [0.1.0] - 2026-01-15

### Added
- View GitHub Project boards directly in VS Code sidebar
- Mirrors your project views (Board, Table, Roadmap) exactly as configured on GitHub
- Auto-detect repository from git remote
- **Start Working** workflow:
  - Creates feature branches with configurable naming pattern
  - Checks git status before branch creation (uncommitted changes, behind origin)
  - Automatically moves issues to configured status
- **Planning Board** webview for visual project management
- Create new issues with template support
- Configure default issue template
- Link branches to issues
- Switch to linked branches directly from sidebar
- Move items between statuses
- Filter to show only items assigned to you
- Hide specific views from sidebar
- Show/hide empty columns
- Configurable status transitions for PR opened/merged events

### Configuration Options
- `ghProjects.mainBranch` - Main branch name (default: "main")
- `ghProjects.branchNamePattern` - Pattern for new branches
- `ghProjects.startWorkingStatus` - Status when starting work
- `ghProjects.prOpenedStatus` - Status when PR is opened
- `ghProjects.prMergedStatus` - Status when PR is merged
- `ghProjects.showOnlyAssignedToMe` - Filter to your items
- `ghProjects.hiddenViews` - Views to hide
- `ghProjects.showEmptyColumns` - Show empty status columns
- `ghProjects.defaultIssueTemplate` - Default template for new issues
- `ghProjects.allowBlankIssues` - Allow creating blank issues

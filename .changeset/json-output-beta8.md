---
"@bretwardjames/ghp-cli": patch
"@bretwardjames/ghp-core": patch
---

feat(cli): add --json output option to list commands

- `ghp work --json` - list assigned items as JSON
- `ghp plan --json` - list project items as JSON  
- `ghp worktree list --json` - list worktrees as JSON
- `ghp agents list --json` - list running agents as JSON

Also includes:
- `--hide-done` filter support for `ghp plan`
- Silent check-coordination hook to prevent settings.local.json corruption
- gh→ghp command mapping documentation in CLAUDE.md

---
"@bretwardjames/ghp-cli": minor
"@bretwardjames/ghp-core": minor
---

Add parallel work mode with git worktrees

- `ghp start <issue> --parallel` creates worktree instead of switching branches
- `ghp switch <issue> --parallel` same for switch command
- `ghp worktree list` and `ghp worktree remove <issue>` commands
- Automatic worktree setup: copies .env files, runs install command
- Active label protection for issues with active worktrees
- VS Code extension support with "Start in Worktree" command
- Cleanup prompts when marking issues as done

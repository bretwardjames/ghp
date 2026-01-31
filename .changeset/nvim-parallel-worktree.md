---
"@bretwardjames/ghp-cli": patch
---

fix(cli): switch back to original branch after creating parallel worktree

Previously, `ghp start --parallel` would switch back to `main` after creating a worktree. Now it returns to the branch you were on before running the command. Also adds a warning when starting from detached HEAD state.

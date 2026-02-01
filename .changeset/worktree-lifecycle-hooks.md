---
"@bretwardjames/ghp-core": minor
"@bretwardjames/ghp-cli": minor
---

Add worktree lifecycle events to hook system

New events:
- `worktree-created` - fires after `ghp start --parallel` creates a worktree
- `worktree-removed` - fires after `ghp worktree remove` removes a worktree

New template variables:
- `${worktree.path}` - absolute path to the worktree
- `${worktree.name}` - directory name of the worktree

Example usage:
```bash
ghp hooks add ts-funnel-up \
  --event worktree-created \
  --command "ts-magic up ${worktree.path}"
```

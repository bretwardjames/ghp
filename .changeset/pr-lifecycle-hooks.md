---
"@bretwardjames/ghp-core": minor
"@bretwardjames/ghp-cli": minor
---

Fire PR lifecycle hooks in ghp pr command

- Fire `pre-pr` hooks before PR creation (with changed files, diff stats)
- Fire `pr-creating` hooks just before GitHub API call (with proposed title/body)
- Fire `pr-created` hooks after successful creation
- Add `--force` flag to bypass blocking hook failures
- Add `--no-hooks` flag to skip all hooks
- Hooks now fire from core workflow layer (available to MCP, VS Code, nvim)

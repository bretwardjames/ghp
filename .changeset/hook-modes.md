---
"@bretwardjames/ghp-core": minor
"@bretwardjames/ghp-cli": minor
---

Add hook execution modes (fire-and-forget, blocking, interactive)

Hooks can now specify a `mode` that controls behavior on completion:

- `fire-and-forget` (default): Silent execution, logged only, never aborts workflow
- `blocking`: Shows output on failure, non-zero exit aborts workflow
- `interactive`: Always shows output, prompts user to continue (y), abort (N), or view full output (v)

New CLI options for `ghp hooks add`:
- `--mode <mode>`: Set the execution mode
- `--continue-prompt <text>`: Custom prompt text for interactive mode

Hooks can also configure custom exit code classification via the `exitCodes` field in the config file.

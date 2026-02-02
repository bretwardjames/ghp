---
"@bretwardjames/ghp-core": minor
---

Add `pre-pr` and `pr-creating` hook events for PR creation flow

- `pre-pr`: Fires before PR creation begins, useful for validation, linting, and convention checks. Payload includes `changed_files` and `diff_stat`.
- `pr-creating`: Fires just before GitHub API call, useful for suggesting PR title/body. Payload includes proposed `title` and `body`.

Both events include `repo`, `branch`, and `base` fields.

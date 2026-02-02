---
"@bretwardjames/ghp-cli": patch
---

fix(cli): include issue body in issue-started hook payload

The `issue-started` event hook now includes the actual issue body instead of an empty string. This enables hooks to access the full issue description via `${issue.body}` or `${issue.json}` template variables.

Relates to #217

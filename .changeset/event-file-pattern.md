---
"@bretwardjames/ghp-core": minor
---

Add event file pattern for complex hook data

Hooks can now access the full event payload via `${_event_file}`, which points to a temporary JSON file containing the complete event data. This is useful for hooks that need to process complex data structures (arrays, nested objects) that are difficult to pass via shell escaping.

- Event file is written to `/tmp/ghp-event-{random}.json` before hook execution
- File permissions set to 0600 (owner read/write only) for security
- File is automatically cleaned up after hook execution completes
- Works alongside all existing template variables

Example usage:
```bash
ragtime check --event-file ${_event_file}
```

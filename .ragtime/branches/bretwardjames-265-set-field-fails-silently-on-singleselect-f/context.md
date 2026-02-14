---
type: context
branch: bretwardjames/265-set-field-fails-silently-on-singleselect-f
issue: 265
status: active
created: '2026-02-14'
author: bretwardjames
---

## Issue

**#265**: set_field fails silently on SingleSelect fields



## Description

## Description

`set_field` returns `Failed to set field value.` when trying to set SingleSelect fields (Priority, Size) on a project item, even when the field name and value are correct.

## Steps to Reproduce

1. Create an issue and add it to a project via `create_issue` with `project` and `status` params (this works)
2. Call `set_field` with valid field/value:
   ```
   set_field(issue=77, field="Priority", value="high")
   ```
3. Returns: `Failed to set field value.`

Same failure for:
```
set_field(issue=77, field="Size", value="sm")
```

## Expected Behavior

Should set the field value on the project item.

## Workaround

Using `gh project item-edit` directly with explicit project ID, item ID, field ID, and option ID works:
```bash
gh project item-edit --project-id PVT_xxx --id PVTI_xxx --field-id PVTSSF_xxx --single-select-option-id c43c73c9
```

## Context

- The issue IS in the project (confirmed via `gh project item-list`)
- `get_fields` correctly returns the field names and valid options
- `create_issue` with `status` param works (so the project linkage is fine)
- Only `set_field` on SingleSelect fields fails
- No detailed error message is returned, just the generic failure string

<!-- ghp-branch: bretwardjames/265-set-field-fails-silently-on-singleselect-f -->

## Plan

<!-- Implementation steps - fill in or let Claude generate -->

- [ ] TODO: Define implementation steps

## Acceptance Criteria

<!-- What needs to be true for this to be complete? -->

## Notes

<!-- Additional context, decisions, blockers -->


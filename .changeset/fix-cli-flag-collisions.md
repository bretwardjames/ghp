---
"@bretwardjames/ghp-cli": minor
---

Fix CLI flag collisions and add validation

## Breaking Changes: Short Flag Removals

The following short flags have been removed to fix semantic collisions where the same letter had completely different meanings across commands:

### Critical Collisions Fixed

| Removed | Long Form | Command | Reason |
|---------|-----------|---------|--------|
| `-f` | `--flat` | `work` | Conflicted with `--force` in 4 other commands |
| `-a` | `--assign` | `add issue/epic` | Conflicted with `--all` in 4 other commands |
| `-c` | `--create` | `pr` | Conflicted with `--config`, `--context`, `--command` |
| `-m` | `--mine` | `plan` | Conflicted with `--message`, `--mode` |

### High Severity Collisions Fixed

| Removed | Long Form | Command | Reason |
|---------|-----------|---------|--------|
| `-t` | `--type` | `progress` | Conflicted with `--template`, `--timeout` |
| `-s` | `--show` | `config` | Conflicted with `--status` in 3 commands |
| `-p` | `--parent` | `set-parent` | Conflicted with `--project` everywhere |
| `-b` | `--browser` | `open` | Conflicted with `--body` |

### Changed Short Flags

| Old | New | Long Form | Command |
|-----|-----|-----------|---------|
| `-l` | `-L` | `--labels` | `add issue/epic` |

## Migration Guide

Update any scripts or muscle memory:

```bash
# Before → After
ghp work -f          →  ghp work --flat
ghp add -a user      →  ghp add --assign user
ghp pr -c            →  ghp pr --create
ghp plan -m          →  ghp plan --mine
ghp progress -t Epic →  ghp progress --type Epic
ghp config -s        →  ghp config --show
ghp set-parent -p 1  →  ghp set-parent --parent 1
ghp open 123 -b      →  ghp open 123 --browser
ghp add -l bug       →  ghp add -L bug
```

## New Features: Flag Validation

Commands now validate flag values and provide clear error messages:

### Enum Validation
- `--branch-action` validates: `create`, `link`, `skip`
- `--assign` (action mode) validates: `reassign`, `add`, `skip`
- `--group` validates: `status`, `type`, `assignee`, `priority`, `size`, `labels`
- `--mode` (event hooks) validates: `fire-and-forget`, `blocking`, `interactive`

### Mutual Exclusivity
- `--squash` and `--rebase` cannot be used together (merge)
- `--nvim`, `--claude`, `--terminal-only` are mutually exclusive (start/switch)

### Numeric Bounds
- `--max-diff-lines` validates range 1-100000

Example error messages:
```
Error: Invalid value for --group: "invalid"
Valid values: status, type, assignee, priority, size, labels

Error: Flags --squash and --rebase cannot be used together
These flags are mutually exclusive. Use only one.
```

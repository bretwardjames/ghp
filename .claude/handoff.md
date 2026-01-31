## Author: claude

## Updated: 2026-01-31

## Branch: bretwardjames/206-add-ragtime-plugin-system-for-context-awar

### What This Branch Does

Adds an **event hooks system** to ghp-cli that allows external tools (like ragtime) to respond to lifecycle events. Hooks are shell commands with template variable substitution.

---

## IMPLEMENTATION PLAN

1. ✅ Refactor types.ts for event hooks (not plugins)
2. ✅ Update registry.ts for event-hooks.json config file
3. ✅ Add template variable substitution to executor
4. ✅ Remove builtin.ts and ragtime-specific code (plugins are user-registered)
5. ✅ Rename CLI commands from plugins to hooks
6. ✅ Add hook invocation to ghp start (issue-started event)
7. ✅ Add hook invocation to ghp add (issue-created event)

---

## CURRENT STATE

All implementation tasks are complete. The event hooks system is fully functional.

### Architecture

Hooks are stored in `~/.config/ghp-cli/event-hooks.json` and fire on lifecycle events:

| Event | Trigger | Template Variables |
|-------|---------|-------------------|
| `issue-created` | After `ghp add` | `${issue.number}`, `${issue.json}`, `${issue.title}`, `${repo}` |
| `issue-started` | After `ghp start` | `${issue.number}`, `${issue.json}`, `${branch}`, `${repo}` |
| `pr-created` | After `ghp pr --create` | (future enhancement) |
| `pr-merged` | After PR merge | (future enhancement) |

### New CLI Commands

```bash
ghp hooks list                    # List all registered hooks
ghp hooks add <name> \            # Add a new hook
  --event issue-started \
  --command "ragtime new-branch \${issue.number} --issue-json '\${issue.json}'"
ghp hooks remove <name>           # Remove a hook
ghp hooks enable <name>           # Enable a disabled hook
ghp hooks disable <name>          # Disable without removing
ghp hooks show <name>             # Show hook details
```

### Files Changed

**Core package (`packages/core/src/plugins/`):**
- `types.ts` - EventHook, EventType, payload interfaces
- `registry.ts` - CRUD for event-hooks.json
- `executor.ts` - Template substitution and hook execution
- `index.ts` - Re-exports
- Removed: `builtin.ts` (no more built-in plugin definitions)

**CLI package (`packages/cli/src/`):**
- `commands/event-hooks.ts` - New CLI commands for hook management
- `commands/add-issue.ts` - Fire `issue-created` event
- `commands/start.ts` - Fire `issue-started` event
- `index.ts` - Register hooks commands

### Example: Ragtime Integration

```bash
# Register ragtime hook
ghp hooks add ragtime-context \
  --event issue-started \
  --command "ragtime new-branch \${issue.number} --issue-json '\${issue.json}'"

# Now when you run `ghp start 42`:
# 1. Branch is created/switched
# 2. issue-started hooks fire
# 3. ragtime new-branch is called with issue context
# 4. Context is stored in .claude/memory/branches/
```

---

## WHAT'S LEFT TO DO

- [ ] Add tests for the event hooks system
- [ ] Implement `pr-created` hook in pr.ts (requires parsing PR output)
- [ ] Consider adding `pr-merged` hook
- [ ] Update documentation/README
- [ ] Create changeset for release

---

## DESIGN DECISIONS

1. **Event hooks vs plugins**: Simpler design where ghp emits events and external tools handle their own logic. No built-in plugin definitions.

2. **Template variables vs env vars**: Template variables (`${issue.json}`) are substituted directly in the command string, making hooks more explicit and debuggable.

3. **Separate config file**: `event-hooks.json` is separate from `dashboard-hooks.json` to keep concerns isolated.

4. **Sequential execution**: Hooks run sequentially (not parallel) to avoid race conditions and provide predictable output.

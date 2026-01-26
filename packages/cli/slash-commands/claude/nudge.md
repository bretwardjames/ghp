---
description: Check coordination chats for new messages
---

# Nudge - Check Coordination Chats

When you receive this command, immediately check for new messages in the coordination system.

## Your Role

Determine your role from `CLAUDE_AGENT_ROLE` environment variable or infer from context:
- `principal` - Check project-chat.md for messages from epic managers
- `epic-*-manager` - Check project-chat.md (from principal) AND your epic's chat.md (from workers)
- `worker-*` - Check your epic's chat.md for messages from epic manager

## Files to Check

```
~/.config/ghp-cli/coordination/project-chat.md      # Principal <-> Epic Managers
~/.config/ghp-cli/coordination/epics/<N>/chat.md    # Epic Manager <-> Workers
```

## What to Do

1. **Read the relevant chat file(s)** based on your role
2. **Find messages addressed to you** (format: `sender → <your-role>`)
3. **Report what you found** - summarize any new messages
4. **Take action** on any pending requests or instructions
5. **Respond if needed** using the send-coordination-message.sh script

## Response Format

After checking, report:
- New messages found (if any)
- Actions you're taking in response
- Current status of your work

If no new messages, confirm you checked and continue with current work.

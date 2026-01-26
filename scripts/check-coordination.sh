#!/bin/bash
# Coordination check script - runs on Stop/SubagentStop hook
# Updates heartbeat in agent-status.json
#
# IMPORTANT: This script must be SILENT (no stdout output) to comply with
# Claude Code's hook contract. Any output would be misinterpreted as JSON
# and could corrupt settings.local.json.
#
# Install to: ~/.config/ghp-cli/bin/check-coordination.sh

COORD_DIR="$HOME/.config/ghp-cli/coordination"
STATUS_FILE="$COORD_DIR/agent-status.json"
ROLE="${CLAUDE_AGENT_ROLE:-unknown}"

# Exit silently if no role configured
if [ "$ROLE" = "unknown" ]; then
    exit 0
fi

# Ensure coordination directory exists
mkdir -p "$COORD_DIR"

# Ensure status file exists
if [ ! -f "$STATUS_FILE" ]; then
    echo '{}' > "$STATUS_FILE"
fi

# Update heartbeat
TIMESTAMP=$(date -Iseconds)
TMP_FILE=$(mktemp)
if jq --arg role "$ROLE" \
   --arg time "$TIMESTAMP" \
   '.[$role].lastSeen = $time | .[$role].status = "active"' \
   "$STATUS_FILE" > "$TMP_FILE" 2>/dev/null; then
    mv "$TMP_FILE" "$STATUS_FILE"
else
    rm -f "$TMP_FILE"
fi

# Exit silently - all coordination data is in agent-status.json
# Use `ghp agents` or read agent-status.json directly to check status
exit 0

# Distributed LLM Agent Coordination - Architecture Handoff

## Overview

This document captures the architecture discussion for enabling multiple LLM agents to coordinate on a shared project. The goal is to allow an **orchestrator** agent (talking to a human) to delegate work to **worker** agents, with optional **epic manager** agents coordinating larger efforts.

## Agent Hierarchy

```
Human
  ↓
Orchestrator Agent (converses with human, delegates work)
  ↓
Epic Manager Agent (optional - coordinates an epic's sub-issues)
  ↓
Worker Agents (implement individual features/issues)
```

## Communication Options Considered

### Option 1: Chat MD Files
- Agents write to shared markdown files (like `coordination.md`)
- Simple, human-readable, version-controlled
- **Con:** No real-time awareness, relies on polling

### Option 2: mem0 Polling
- Agents write status updates to mem0 memories
- Other agents poll for relevant memories
- **Con:** mem0 optimized for retrieval, not messaging

### Option 3: Message Bus (Redis, NATS, etc.)
- Real-time pub/sub communication
- **Con:** Infrastructure overhead, agents need to stay running

### Option 4: File-Based Queue
- Agents write JSON messages to a queue directory
- Watchers pick up and process messages
- **Con:** More complex than needed for low-frequency updates

## Multi-User Coordination Options

### Option A: Shared Epic Manager
- Single epic manager coordinates all workers
- **Con:** Bottleneck, single point of failure

### Option B: Federated (Per-User Epic Managers)
- Each user has their own epic manager
- Managers sync via shared state
- **Con:** Complex conflict resolution

### Option C: Document-Centric (Selected)
- **No persistent manager agents** - just workers and orchestrators
- Shared documents (plans, status, decisions) ARE the coordination layer
- Authority determined by issue assignment
- Conflicts escalate to human
- mem0 for long-term knowledge retention

## Selected Architecture: Document-Centric (Option C)

### Core Principles

1. **Documents as Truth**: Status files, plan files, and issue descriptions are the source of truth
2. **Stateless Coordination**: No long-running manager agents required
3. **Authority via Assignment**: Whoever is assigned an issue has authority over it
4. **Human Escalation**: Conflicts or cross-cutting concerns go to the human
5. **mem0 for Memory**: Long-term knowledge stored in mem0, not coordination state

### Why This Works

- LLM agents are inherently stateless (context windows reset)
- Documents persist naturally and are human-readable
- No infrastructure beyond git and file system
- Scales with number of workers without coordination overhead
- Humans remain in control of conflict resolution

## Message Types

Even in a document-centric model, agents need to communicate certain things:

| Type | Purpose | Medium |
|------|---------|--------|
| **Status** | "I completed X" / "I'm blocked on Y" | Status file in repo |
| **Heartbeat** | "I'm still working on issue #123" | Timestamp in status file |
| **Request** | "I need clarification on X" | Comment on issue or escalation file |
| **Command** | "Start working on #124" | Issue assignment |
| **Context** | "Here's what you need to know" | handoff.md or mem0 |
| **Escalation** | "Human decision needed" | Escalation file or issue comment |

## Heartbeat / Status Tracking

### Approach
- Workers update a status file periodically (every 1-5 minutes while active)
- Status includes: current issue, last action, timestamp
- Orchestrator can poll to see which workers are active

### Status File Format (`agent-status.json`)
```json
{
  "agents": {
    "worker-1": {
      "issue": 147,
      "status": "implementing",
      "lastAction": "Created dashboard command skeleton",
      "timestamp": "2025-01-25T10:30:00Z"
    },
    "worker-2": {
      "issue": 148,
      "status": "blocked",
      "lastAction": "Waiting for #147 to complete",
      "timestamp": "2025-01-25T10:28:00Z"
    }
  }
}
```

### Stale Detection
- If timestamp > 10 minutes old, agent likely disconnected
- Orchestrator can reassign or alert human

## Authority Rules

1. **Issue Owner**: Agent assigned to an issue has authority over files in that scope
2. **Shared Files**: Changes to shared files (README, core modules) require orchestrator approval
3. **Conflicts**: If two agents need to modify the same file, escalate to human
4. **Blocking**: If Agent A is blocked on Agent B's work, Agent A updates status and waits

## Implementation in GHP

This coordination system could be built into GHP:

1. **`ghp agent-status`** - View/update agent status file
2. **`ghp agent-heartbeat`** - Update timestamp for current agent
3. **`ghp agent-escalate`** - Create escalation for human review
4. **`ghp agent-handoff`** - Generate context handoff for another agent

## Open Questions

1. **Where does status file live?** `.ghp/agent-status.json` in repo? Or `~/.config/ghp-cli/`?
2. **How do agents identify themselves?** Session ID? Configured name?
3. **Should orchestrator auto-reassign stale issues?** Or just alert human?
4. **How to handle branch conflicts?** Each agent on own branch? Shared branch with coordination?

## Next Steps

1. Decide on status file location and format
2. Implement basic status tracking commands
3. Test with two Claude Code sessions on same repo
4. Iterate based on real coordination needs

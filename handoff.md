# Branch Dashboard Feature - Implementation Handoff

## Overview

We're building a **Branch Dashboard** feature for GHP that shows a comprehensive view of all work done on a branch (like a local PR view), with an extensible **hook system** that allows external tools to register and display their own content.

## Issues to Implement

**Epic:** #146 - Branch Dashboard with External Hook System

**Sub-issues (suggested order):**
1. **#147** - Core dashboard command (`ghp dashboard`) - Foundation
2. **#148** - Hook registration system - Config and management
3. **#149** - Hook execution and rendering - Makes hooks actually work
4. **#150** - Hook API documentation - Enables external tool authors
5. **#151** - VS Code extension dashboard panel
6. **#152** - Neovim plugin dashboard integration

## Architecture Decisions Already Made

### 1. Command-based hooks

External tools register a CLI command (e.g., `m0 dashboard-data`). GHP executes the command with branch context:

```bash
<command> --branch <branch> --repo <repo>
```

Command returns JSON in a specified format. This is language-agnostic - hooks can be written in any language.

### 2. Hook registration via config file

**Location:** `~/.config/ghp-cli/dashboard-hooks.json`

**Schema:**
```json
{
  "hooks": [
    {
      "name": "mem0",
      "displayName": "Memory Store",
      "command": "m0 dashboard-data",
      "category": "memories",
      "enabled": true,
      "timeout": 5000
    }
  ]
}
```

### 3. Hook response format

```typescript
interface HookResponse {
  success: boolean;
  data: {
    title: string;
    items: HookItem[];
  };
  error?: string;
}

interface HookItem {
  id: string;
  type: string;        // 'memory', 'document', 'note', etc.
  title: string;
  summary?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}
```

### 4. Core dashboard displays

- Full diff against main (`git diff main...HEAD`)
- Diff stats (`git diff --stat main...HEAD`)
- Commit history (`git log main..HEAD --oneline`)
- Changed files count
- "External Changes" section populated by hooks

## Why This Feature

The user uses Claude Code heavily for development. Claude writes code, updates docs, and manages memories. The user needs a single view to see:

- What code changes have been made on the branch
- What context documents exist (handoff.md, plan files)
- What memories have been stored (via a future memory package)

The hook system allows the memory package (being built separately) to register itself and display branch-specific memories without GHP needing to know anything about mem0 or vector databases.

## Patterns to Follow

- Follow the existing MCP tool registry pattern in `/packages/mcp/src/tool-registry.ts` for inspiration on the hook registry
- Follow existing command patterns in `/packages/cli/src/commands/`
- Core logic goes in `/packages/core/src/dashboard/`
- Reuse existing git-utils functions where possible

## Files You'll Likely Create/Modify

### New files

- `/packages/core/src/dashboard/index.ts` - Core dashboard functions
- `/packages/core/src/dashboard/hooks.ts` - Hook registry and execution
- `/packages/cli/src/commands/dashboard.ts` - CLI command
- `/packages/apps/vscode/src/dashboard-panel.ts` - VS Code panel

### Existing files to reference

- `/packages/core/src/git-utils.ts` - Git operations
- `/packages/cli/src/commands/pr.ts` - Already does `git diff main...HEAD`
- `/packages/mcp/src/tool-registry.ts` - Registry pattern example
- `/packages/core/src/agents/registry.ts` - File-based registry example

## Getting Started

Start with issue #147 (core dashboard command):

```bash
ghp start 147
```

This will create a worktree and set up the branch for you.

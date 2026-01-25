# Dashboard Hook API Documentation

The GHP CLI dashboard supports external hooks that allow any tool to contribute custom sections to the branch overview. This guide explains how to create, register, and manage hooks.

## Table of Contents

- [Overview](#overview)
- [Registration Guide](#registration-guide)
- [Command Contract](#command-contract)
- [Response Schema](#response-schema)
- [Best Practices](#best-practices)
- [Example Implementations](#example-implementations)
- [Troubleshooting](#troubleshooting)

## Overview

### What is the Hook System?

The dashboard hook system enables external tools to inject custom data sections into the `ghp dashboard` output. When you run `ghp dashboard`, it:

1. Collects branch metadata (commits, issue status, PR info)
2. Executes all enabled hooks in parallel
3. Merges hook responses into the dashboard output

This architecture allows any tool - regardless of implementation language - to extend the dashboard with relevant context.

### Use Cases

- **Memory systems**: Display relevant memories or notes for the current branch
- **Documentation**: Show related docs or specs
- **CI/CD status**: Display build status from custom CI systems
- **Code analysis**: Show lint warnings, type errors, or security issues
- **Team tools**: Display Slack threads, meeting notes, or discussions
- **Custom metrics**: Show code coverage, performance benchmarks, etc.

### How It Works

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  ghp dashboard  │────▶│  Hook Registry   │────▶│  Your Command   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
                                                          ▼
                                                  ┌─────────────────┐
                                                  │   JSON Output   │
                                                  └─────────────────┘
```

## Registration Guide

### Configuration File Location

Hooks are stored in:

```
~/.config/ghp-cli/dashboard-hooks.json
```

The file uses restricted permissions (`0600`) since it contains executable commands.

### CLI Commands

#### List all hooks

```bash
ghp dashboard hooks list
```

#### Add a new hook

```bash
ghp dashboard hooks add <name> \
  --command "<command>" \
  --display-name "Display Name" \
  --category "category" \
  --timeout 5000
```

**Arguments:**
- `<name>` - Unique identifier (alphanumeric, dashes, underscores only)
- `--command` - The CLI command to execute (required)
- `--display-name` - Human-readable name (optional, defaults to name)
- `--category` - Category for grouping (optional, defaults to "other")
- `--timeout` - Max execution time in ms (optional, defaults to 5000)

**Example:**

```bash
ghp dashboard hooks add my-memories \
  --command "my-tool get-memories" \
  --display-name "Project Memories" \
  --category "context"
```

#### Remove a hook

```bash
ghp dashboard hooks remove <name>
```

#### Enable/Disable a hook

```bash
ghp dashboard hooks enable <name>
ghp dashboard hooks disable <name>
```

#### Show hook details

```bash
ghp dashboard hooks show <name>
```

### Hook Schema Reference

The configuration file structure:

```json
{
  "hooks": [
    {
      "name": "my-hook",
      "displayName": "My Custom Hook",
      "command": "my-tool dashboard-hook",
      "category": "context",
      "enabled": true,
      "timeout": 5000
    }
  ]
}
```

**Field Definitions:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | Yes | - | Unique identifier. Must match `/^[\w\-]+$/` and be < 64 chars |
| `displayName` | string | No | `name` | Human-readable name shown in dashboard |
| `command` | string | Yes | - | Shell command to execute |
| `category` | string | No | `"other"` | Category for grouping hooks |
| `enabled` | boolean | No | `true` | Whether the hook is active |
| `timeout` | number | No | `5000` | Max execution time in milliseconds |

## Command Contract

### Arguments Passed to Your Command

When a hook is executed, the following arguments are appended to your command:

```bash
<your-command> --branch <branch-name> --repo <owner/repo>
```

**Example:**

If your hook command is `my-tool get-memories`, it will be called as:

```bash
my-tool get-memories --branch feature/my-feature --repo bretwardjames/ghp
```

### Expected Behavior

Your command must:

1. Accept `--branch` and `--repo` arguments
2. Output valid JSON to stdout
3. Exit with code 0 on success
4. Complete within the configured timeout

### Error Handling Requirements

- **Exit code 0**: Success - stdout parsed as JSON
- **Non-zero exit code**: Failure - stderr used as error message
- **Timeout exceeded**: Treated as failure
- **Invalid JSON**: Treated as failure with parse error

## Response Schema

### TypeScript Interface Definitions

```typescript
/**
 * Response format from hook commands
 */
interface HookResponse {
  /** Whether the hook executed successfully */
  success: boolean;
  /** Data returned by the hook */
  data?: {
    /** Section title */
    title: string;
    /** Items to display */
    items: HookItem[];
  };
  /** Error message if success is false */
  error?: string;
}

/**
 * Item returned by a hook
 */
interface HookItem {
  /** Unique identifier */
  id: string;
  /** Item type (e.g., 'memory', 'document', 'note') */
  type: string;
  /** Item title */
  title: string;
  /** Optional summary/description */
  summary?: string;
  /** Optional timestamp */
  timestamp?: string;
  /** Optional additional metadata */
  metadata?: Record<string, unknown>;
}
```

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "HookResponse",
  "type": "object",
  "required": ["success"],
  "properties": {
    "success": {
      "type": "boolean",
      "description": "Whether the hook executed successfully"
    },
    "data": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string",
          "description": "Section title displayed in dashboard"
        },
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/HookItem"
          }
        }
      },
      "required": ["title", "items"]
    },
    "error": {
      "type": "string",
      "description": "Error message if success is false"
    }
  },
  "definitions": {
    "HookItem": {
      "type": "object",
      "required": ["id", "type", "title"],
      "properties": {
        "id": {
          "type": "string",
          "description": "Unique identifier for the item"
        },
        "type": {
          "type": "string",
          "description": "Item type (e.g., 'memory', 'document', 'note')"
        },
        "title": {
          "type": "string",
          "description": "Item title"
        },
        "summary": {
          "type": "string",
          "description": "Optional summary or description"
        },
        "timestamp": {
          "type": "string",
          "description": "Optional ISO 8601 timestamp"
        },
        "metadata": {
          "type": "object",
          "description": "Optional additional key-value pairs"
        }
      }
    }
  }
}
```

### Example Responses

#### Success Response

```json
{
  "success": true,
  "data": {
    "title": "Related Memories",
    "items": [
      {
        "id": "mem-001",
        "type": "memory",
        "title": "Authentication Flow Design",
        "summary": "JWT-based auth with refresh tokens, 15-min access token expiry",
        "timestamp": "2024-01-15T10:30:00Z",
        "metadata": {
          "author": "user@example.com",
          "tags": ["auth", "security"]
        }
      },
      {
        "id": "mem-002",
        "type": "decision",
        "title": "Use PostgreSQL for User Data",
        "summary": "Chosen over MongoDB for ACID compliance requirements",
        "timestamp": "2024-01-14T14:20:00Z"
      }
    ]
  }
}
```

#### Success Response (Empty)

```json
{
  "success": true,
  "data": {
    "title": "Related Memories",
    "items": []
  }
}
```

#### Failure Response

```json
{
  "success": false,
  "error": "Failed to connect to memory service: connection timeout"
}
```

## Best Practices

### Timeout Handling

The default timeout is 5000ms (5 seconds). Consider:

- **Fast operations**: Keep the default
- **Network calls**: Consider 10000ms if calling external APIs
- **Heavy computation**: Consider up to 30000ms, but optimize if possible

```bash
# Register with custom timeout
ghp dashboard hooks add slow-hook \
  --command "slow-tool analyze" \
  --timeout 15000
```

**In your hook implementation:**

```javascript
// Set your own internal timeout slightly below the configured one
const INTERNAL_TIMEOUT = 4500; // Leave 500ms buffer

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), INTERNAL_TIMEOUT);

try {
  const result = await fetch(url, { signal: controller.signal });
  // ...
} finally {
  clearTimeout(timeout);
}
```

### Caching Recommendations

For hooks that query external services:

1. **Cache results locally** for the duration of the dashboard session
2. **Use branch name as cache key** - data is often branch-specific
3. **Set reasonable TTL** - 5-30 seconds for frequently changing data
4. **Invalidate on relevant events** (commits, pushes)

```javascript
// Simple file-based cache example
const CACHE_DIR = path.join(os.tmpdir(), 'my-hook-cache');
const CACHE_TTL = 30000; // 30 seconds

function getCached(branch) {
  const cacheFile = path.join(CACHE_DIR, `${branch}.json`);
  if (fs.existsSync(cacheFile)) {
    const stat = fs.statSync(cacheFile);
    if (Date.now() - stat.mtimeMs < CACHE_TTL) {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    }
  }
  return null;
}
```

### Error Message Guidelines

When returning errors:

1. **Be specific**: Include what failed and why
2. **Be actionable**: Suggest how to fix the issue if possible
3. **Avoid stack traces**: They clutter the dashboard output
4. **Keep it short**: One or two sentences maximum

**Good:**
```json
{"success": false, "error": "Memory service unavailable. Check if mem0 is running."}
```

**Bad:**
```json
{"success": false, "error": "Error: ECONNREFUSED 127.0.0.1:8080\n    at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1141:16)"}
```

### Security Considerations

1. **Validate inputs**: The `--branch` and `--repo` arguments come from the user's environment, but always validate them
2. **Avoid shell injection**: Don't pass arguments directly to shell commands
3. **Minimal permissions**: Your hook only needs read access to relevant data
4. **No secrets in output**: Don't include API keys or credentials in responses

## Example Implementations

### Node.js / TypeScript

```typescript
#!/usr/bin/env node
// File: my-hook.ts

import { parseArgs } from 'util';

interface HookResponse {
  success: boolean;
  data?: {
    title: string;
    items: Array<{
      id: string;
      type: string;
      title: string;
      summary?: string;
      timestamp?: string;
      metadata?: Record<string, unknown>;
    }>;
  };
  error?: string;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      branch: { type: 'string' },
      repo: { type: 'string' },
    },
  });

  const branch = values.branch;
  const repo = values.repo;

  if (!branch || !repo) {
    const response: HookResponse = {
      success: false,
      error: 'Missing required arguments: --branch and --repo',
    };
    console.log(JSON.stringify(response));
    process.exit(1);
  }

  try {
    // Your logic here - fetch memories, analyze code, etc.
    const items = await fetchRelevantData(branch, repo);

    const response: HookResponse = {
      success: true,
      data: {
        title: 'My Custom Data',
        items,
      },
    };
    console.log(JSON.stringify(response));
  } catch (error) {
    const response: HookResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    console.log(JSON.stringify(response));
    process.exit(1);
  }
}

async function fetchRelevantData(branch: string, repo: string) {
  // Implementation specific to your tool
  return [
    {
      id: '1',
      type: 'note',
      title: `Notes for ${branch}`,
      summary: 'Example item',
    },
  ];
}

main();
```

**Register:**

```bash
ghp dashboard hooks add my-ts-hook \
  --command "npx ts-node /path/to/my-hook.ts" \
  --display-name "My TypeScript Hook" \
  --category "context"
```

### Python

```python
#!/usr/bin/env python3
# File: my_hook.py

import argparse
import json
import sys
from typing import TypedDict, Optional, List, Any


class HookItem(TypedDict, total=False):
    id: str
    type: str
    title: str
    summary: Optional[str]
    timestamp: Optional[str]
    metadata: Optional[dict[str, Any]]


class HookData(TypedDict):
    title: str
    items: List[HookItem]


class HookResponse(TypedDict, total=False):
    success: bool
    data: Optional[HookData]
    error: Optional[str]


def main() -> None:
    parser = argparse.ArgumentParser(description='Dashboard hook')
    parser.add_argument('--branch', required=True, help='Current branch name')
    parser.add_argument('--repo', required=True, help='Repository (owner/repo)')
    args = parser.parse_args()

    try:
        items = fetch_relevant_data(args.branch, args.repo)
        response: HookResponse = {
            'success': True,
            'data': {
                'title': 'Python Hook Data',
                'items': items,
            },
        }
        print(json.dumps(response))
    except Exception as e:
        response: HookResponse = {
            'success': False,
            'error': str(e),
        }
        print(json.dumps(response))
        sys.exit(1)


def fetch_relevant_data(branch: str, repo: str) -> List[HookItem]:
    """Your implementation here."""
    return [
        {
            'id': '1',
            'type': 'note',
            'title': f'Notes for {branch}',
            'summary': 'Example item from Python hook',
        },
    ]


if __name__ == '__main__':
    main()
```

**Register:**

```bash
ghp dashboard hooks add my-python-hook \
  --command "python3 /path/to/my_hook.py" \
  --display-name "My Python Hook" \
  --category "context"
```

### Bash

```bash
#!/usr/bin/env bash
# File: my-hook.sh

set -euo pipefail

# Parse arguments
BRANCH=""
REPO=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --branch)
            BRANCH="$2"
            shift 2
            ;;
        --repo)
            REPO="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# Validate required arguments
if [[ -z "$BRANCH" || -z "$REPO" ]]; then
    echo '{"success": false, "error": "Missing required arguments: --branch and --repo"}'
    exit 1
fi

# Your logic here
# This example checks for a notes file specific to the branch

NOTES_DIR="$HOME/.my-tool/notes"
NOTES_FILE="$NOTES_DIR/${BRANCH//\//_}.md"

if [[ -f "$NOTES_FILE" ]]; then
    # Read first line as title, rest as summary
    TITLE=$(head -n 1 "$NOTES_FILE" | sed 's/^#* *//')
    SUMMARY=$(tail -n +2 "$NOTES_FILE" | head -c 200)

    # Output JSON (using jq for proper escaping)
    jq -n \
        --arg title "$TITLE" \
        --arg summary "$SUMMARY" \
        --arg branch "$BRANCH" \
        '{
            success: true,
            data: {
                title: "Branch Notes",
                items: [{
                    id: "note-1",
                    type: "note",
                    title: $title,
                    summary: $summary,
                    metadata: { branch: $branch }
                }]
            }
        }'
else
    # No notes found - return empty success
    echo '{"success": true, "data": {"title": "Branch Notes", "items": []}}'
fi
```

**Register:**

```bash
chmod +x /path/to/my-hook.sh
ghp dashboard hooks add my-bash-hook \
  --command "/path/to/my-hook.sh" \
  --display-name "Branch Notes" \
  --category "context"
```

## Troubleshooting

### Hook not appearing in dashboard

1. Check if the hook is enabled:
   ```bash
   ghp dashboard hooks list
   ```

2. Test the hook manually:
   ```bash
   your-command --branch main --repo owner/repo
   ```

3. Verify JSON output is valid:
   ```bash
   your-command --branch main --repo owner/repo | jq .
   ```

### Hook timing out

1. Check the current timeout setting:
   ```bash
   ghp dashboard hooks show <name>
   ```

2. Increase the timeout:
   ```bash
   ghp dashboard hooks remove <name>
   ghp dashboard hooks add <name> --command "..." --timeout 10000
   ```

3. Optimize your hook's performance (see [Caching Recommendations](#caching-recommendations))

### Invalid JSON errors

Common causes:
- Printing debug output to stdout (use stderr instead)
- Trailing commas in JSON
- Unescaped special characters in strings

Test with:
```bash
your-command --branch test --repo test/test 2>/dev/null | python3 -m json.tool
```

### Permission denied

The hooks config file requires `0600` permissions. If you're getting permission errors:

```bash
chmod 600 ~/.config/ghp-cli/dashboard-hooks.json
```

### Command not found

Ensure the command path is absolute or the binary is in your PATH:

```bash
# Use absolute path
ghp dashboard hooks add my-hook --command "/usr/local/bin/my-tool"

# Or ensure it's in PATH
which my-tool  # Should return the path
```

---

## Further Reading

- [GHP CLI Documentation](../README.md)
- [Dashboard Command Reference](../cli/dashboard.md)
- Source code: `packages/core/src/dashboard/hooks.ts`

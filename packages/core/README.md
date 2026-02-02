# @bretwardjames/ghp-core

Shared core library for GHP tools - provides GitHub Projects API interactions, types, and utilities.

Part of the [GHP monorepo](https://github.com/bretwardjames/ghp).

## Installation

```bash
npm install @bretwardjames/ghp-core
```

## Usage

This package is primarily used internally by:
- [@bretwardjames/ghp-cli](https://github.com/bretwardjames/ghp/tree/main/packages/cli) - Command-line tool
- [gh-projects](https://github.com/bretwardjames/ghp/tree/main/apps/vscode) - VS Code extension

## API

```typescript
import { GitHubAPI, parseIssueUrl, BranchLinker } from '@bretwardjames/ghp-core';

// Create API client
const api = new GitHubAPI(token);

// Parse issue URLs
const { owner, repo, number } = parseIssueUrl('https://github.com/owner/repo/issues/123');

// Branch linking
const linker = new BranchLinker(api);
await linker.linkBranch(issueNumber, branchName);
```

### Workflows

High-level workflow functions that combine operations with automatic hook firing. These are used by CLI, MCP, and VS Code extension to ensure consistent behavior.

```typescript
import {
  createIssueWorkflow,
  startIssueWorkflow,
  createPRWorkflow,
  createWorktreeWorkflow,
  removeWorktreeWorkflow,
} from '@bretwardjames/ghp-core';

// Start working on an issue (creates branch, fires hooks)
const result = await startIssueWorkflow(api, {
  repo: { owner: 'user', name: 'repo', fullName: 'user/repo' },
  issueNumber: 123,
  issueTitle: 'Add new feature',
  branchPattern: '{user}/{number}-{title}',
  username: 'developer',
  parallel: true,
  worktreePath: '/path/to/worktree',
});

if (result.success) {
  console.log(`Working on branch ${result.branch}`);
  if (result.worktree) {
    console.log(`Worktree at ${result.worktree.path}`);
  }
}
```

### Event Hooks

Register and execute lifecycle event hooks:

```typescript
import {
  addEventHook,
  executeHooksForEvent,
  type IssueStartedPayload,
} from '@bretwardjames/ghp-core';

// Register a hook
addEventHook({
  name: 'my-hook',
  event: 'issue-started',
  command: 'echo "Started issue ${issue.number} on ${branch}"',
});

// Execute hooks for an event
const payload: IssueStartedPayload = {
  repo: 'owner/repo',
  issue: { number: 123, title: 'Fix bug', body: 'Issue description here...', url: '...' },
  branch: 'feature/123-fix-bug',
};

// Hooks can execute in a specific directory (e.g., inside a worktree)
const results = await executeHooksForEvent('issue-started', payload, {
  cwd: '/path/to/worktree',
});
```

Available events:
- `issue-created` - Fired when a new issue is created
- `issue-started` - Fired when starting work on an issue
- `pr-created` - Fired when a pull request is created
- `pr-merged` - Fired when a pull request is merged
- `worktree-created` - Fired when a worktree is created
- `worktree-removed` - Fired when a worktree is removed

## License

MIT

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

## License

MIT

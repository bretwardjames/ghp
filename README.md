# GHP Monorepo

Unified repository for GitHub Projects tools.

## Packages

| Package | Location | Registry |
|---------|----------|----------|
| `@bretwardjames/ghp-core` | `packages/core` | npm |
| `@bretwardjames/ghp-cli` | `packages/cli` | npm |
| `gh-projects` (VS Code) | `apps/vscode` | VS Code Marketplace |
| `ghp.nvim` | `apps/nvim` | GitHub (vim plugin managers) |

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Build specific package
pnpm --filter @bretwardjames/ghp-core build
```

## Publishing

### 1. Create a changeset
```bash
pnpm changeset
```

### 2. Version packages
```bash
pnpm changeset version
```

### 3. Publish npm packages
```bash
cd packages/core && pnpm publish --access public
cd packages/cli && pnpm publish --access public
```

### 4. Publish VS Code extension
```bash
cd apps/vscode
vsce publish
ovsx publish  # Requires OVSX_PAT env var
```

### 5. Sync Neovim plugin
```bash
./scripts/sync-nvim-mirror.sh
# Then commit and push in the mirror repo
```

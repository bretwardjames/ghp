# Release Playbook

This document describes the complete release workflow for ghp packages.

## Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           RELEASE CYCLE                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐         │
│   │  Enter   │    │  Work +  │    │   PR     │    │  Auto    │         │
│   │  Beta    │───▶│  Change  │───▶│  Merge   │───▶│  Beta    │──┐      │
│   │  Mode    │    │  sets    │    │  to Main │    │ Release  │  │      │
│   └──────────┘    └──────────┘    └──────────┘    └──────────┘  │      │
│        │                                               │         │      │
│        │         ┌─────────────────────────────────────┘         │      │
│        │         │                                               │      │
│        │         ▼                                               │      │
│        │    ┌──────────┐    ┌──────────┐    ┌──────────┐        │      │
│        │    │  Found   │    │  Fix +   │    │   PR     │        │      │
│        │    │   Bug?   │───▶│  Change  │───▶│  Merge   │────────┘      │
│        │    │          │    │  set     │    │          │               │
│        │    └──────────┘    └──────────┘    └──────────┘               │
│        │         │                                                      │
│        │         │ No more bugs                                         │
│        │         ▼                                                      │
│        │    ┌──────────┐    ┌──────────┐    ┌──────────┐               │
│        └───▶│  Exit    │───▶│  Manual  │───▶│  Stable  │               │
│             │  Beta    │    │ Release  │    │  Done!   │               │
│             │  Mode    │    │          │    │          │               │
│             └──────────┘    └──────────┘    └──────────┘               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Packages Released

| Package | Channel | Install Command |
|---------|---------|-----------------|
| `@bretwardjames/ghp-core` | npm | `npm install @bretwardjames/ghp-core` |
| `@bretwardjames/ghp-cli` | npm | `npm install -g @bretwardjames/ghp-cli` |
| `gh-projects` | VS Code Marketplace + GitHub Releases | VS Code extension |
| `ghp.nvim` | GitHub Mirror Repo | Neovim plugin |

## Prerequisites

Before releasing, ensure you have:

1. **npm credentials**: `npm login` or `NPM_TOKEN` in CI
2. **GitHub CLI**: `gh auth login`
3. **VS Code publishing**: `npx vsce login bretwardjames` (for manual releases)
4. **Neovim mirror**: Clone `git@github.com:bretwardjames/ghp.nvim.git` to `../ghp.nvim-mirror`

---

## Phase 1: Starting a Beta Period

When you're ready to start working on the next release:

```bash
# Enter beta prerelease mode
pnpm beta:enter
```

This creates `.changeset/pre.json` which tells changesets you're in beta mode. **Commit this file.**

```bash
git add .changeset/pre.json
git commit -m "chore: enter beta prerelease mode"
git push
```

From this point on, all version bumps will be beta versions (e.g., `0.2.0-beta.0`).

---

## Phase 2: Development Cycle

### Working on a Feature/Fix

```bash
# 1. Create a branch for your work
git checkout -b feature/my-feature

# 2. Do your work...

# 3. Create a changeset describing what you did
pnpm changeset
# Select affected packages, choose bump type (patch/minor/major)
# Write a description of the change

# 4. Commit everything including the changeset
git add -A
git commit -m "feat: add my feature"

# 5. Push and create PR
git push -u origin feature/my-feature
gh pr create
```

### What Happens on PR Merge

**If `AUTO_BETA=true`** (see [CI/CD Configuration](#cicd-configuration)):

The GitHub Action automatically:
1. Checks if you're in beta mode (`.changeset/pre.json` exists)
2. Checks if there are pending changesets
3. Runs `pnpm version` to bump versions (e.g., `0.2.0-beta.0` → `0.2.0-beta.1`)
4. Builds all packages
5. **If `NPM_TOKEN` is configured**: Publishes npm packages with `@beta` tag
6. Creates a GitHub pre-release with the VS Code extension (.vsix)
7. Commits the version changes back to `main`

**If `AUTO_BETA` is not set** (default):

Nothing happens automatically. Release manually:
```bash
git checkout main && git pull
pnpm version && pnpm release:beta
git add -A && git commit -m "chore: release beta" && git push
```

### Manual Beta Release

After your PR merges, release the beta:

```bash
git checkout main && git pull

# Bump version (0.2.0-beta.0 → 0.2.0-beta.1)
pnpm version

# Build and publish everything
pnpm release:beta

# Commit and push version changes
git add -A
git commit -m "chore: release beta v$(node -p "require('./packages/cli/package.json').version")"
git push
```

This publishes:
- npm packages with `@beta` tag (uses your local `npm login`)
- VS Code extension to GitHub releases (pre-release)
- Neovim mirror sync instructions

### Installing Beta Versions

```bash
# npm packages
npm install -g @bretwardjames/ghp-cli@beta
npm install @bretwardjames/ghp-core@beta

# VS Code
# 1. Go to Extensions
# 2. Find "GitHub Projects"
# 3. Click "Switch to Pre-Release Version"

# Neovim (using lazy.nvim) - pin to a beta tag
{
  "bretwardjames/ghp.nvim",
  tag = "v0.2.0-beta.0",  -- or latest beta tag
}
```

---

## Phase 3: Bug Fixes During Beta

Found a bug in the beta? Same workflow:

```bash
# 1. Create fix branch
git checkout main
git pull
git checkout -b fix/auth-bug

# 2. Fix the bug

# 3. Create a changeset (usually patch)
pnpm changeset
# "Fixed authentication timeout issue"

# 4. Commit, push, PR
git add -A
git commit -m "fix: auth timeout issue"
git push -u origin fix/auth-bug
gh pr create

# 5. Merge PR → Auto beta release
# 0.2.0-beta.0 → 0.2.0-beta.1
```

### Version Progression

```
0.1.14        ← last stable
0.2.0-beta.0  ← first beta (feature A)
0.2.0-beta.1  ← bug fix
0.2.0-beta.2  ← feature B
0.2.0-beta.3  ← another fix
0.2.0         ← stable release
```

---

## Phase 4: Stable Release

When beta testing is complete and you're ready for stable:

```bash
# 1. Exit beta mode
pnpm beta:exit

# 2. Create the stable version
pnpm version
# 0.2.0-beta.3 → 0.2.0

# 3. Commit the version changes
git add -A
git commit -m "chore: release v0.2.0"
git push

# 4. Build and publish stable
pnpm release:stable
```

### What `release:stable` Does

1. Builds all packages
2. Publishes npm packages to the main registry (no tag = `@latest`)
3. Creates a VS Code extension and GitHub release (not pre-release)
4. Syncs the Neovim mirror

### Post-Release

After stable release, you can either:

**Option A: Continue with new beta cycle**
```bash
pnpm beta:enter
git add .changeset/pre.json
git commit -m "chore: enter beta for next release"
git push
```

**Option B: Stay in stable mode**
- Don't run `beta:enter`
- PRs will still need changesets
- Merges won't auto-release
- Manually release when ready

---

## Quick Reference

### Scripts

| Command | Description |
|---------|-------------|
| `pnpm beta:enter` | Enter beta prerelease mode |
| `pnpm beta:exit` | Exit beta prerelease mode |
| `pnpm changeset` | Create a changeset for your changes |
| `pnpm version` | Apply version bumps from changesets |
| `pnpm release:beta` | Build and publish all packages to beta |
| `pnpm release:stable` | Build and publish all packages to stable |

### Changeset Bump Types

| Type | When to Use | Example |
|------|-------------|---------|
| `patch` | Bug fixes, small tweaks | `0.2.0` → `0.2.1` |
| `minor` | New features, non-breaking | `0.2.0` → `0.3.0` |
| `major` | Breaking changes | `0.2.0` → `1.0.0` |

### Files to Know

| File | Purpose |
|------|---------|
| `.changeset/pre.json` | Exists when in beta mode |
| `.changeset/*.md` | Pending changesets |
| `.changeset/config.json` | Changesets configuration |
| `.github/workflows/beta-release.yml` | Auto-beta CI workflow |

---

## Adding a New Package

When adding a new npm package to the monorepo:

### 1. Create the Package

```bash
mkdir -p packages/my-new-package
cd packages/my-new-package
pnpm init
```

Ensure `package.json` has:
```json
{
  "name": "@bretwardjames/ghp-newpkg",
  "version": "0.0.0",
  "publishConfig": {
    "access": "public"
  }
}
```

### 2. Update Release Scripts (if needed)

The current `release:beta:npm` and `release:stable:npm` scripts use:
```bash
pnpm -r --filter='./packages/**' publish
```

This automatically includes all packages under `packages/`. If your new package is elsewhere (e.g., `apps/`), update the filter in `package.json`.

### 3. Non-npm Packages (VS Code, Neovim)

For non-npm packages like VS Code extensions or Neovim plugins:

1. Add a dedicated release script in the package's `package.json`
2. Add corresponding `release:beta:<name>` and `release:stable:<name>` scripts to root `package.json`
3. Update the `release:beta` and `release:stable` scripts to call your new scripts

Example for a hypothetical new VS Code extension:
```json
// root package.json
{
  "scripts": {
    "release:beta": "... && pnpm release:beta:newext",
    "release:beta:newext": "pnpm --filter new-extension run release:beta"
  }
}
```

### 4. Changesets Configuration

If the new package should be **excluded** from changesets versioning (e.g., it's versioned separately like the VS Code extension):

Add it to `.changeset/config.json`:
```json
{
  "ignore": ["gh-projects", "your-new-package"]
}
```

> **Note**: Only npm packages in the workspace can be added to the ignore list. Non-npm packages (like the Neovim plugin) don't need to be listed.

---

## Troubleshooting

### "No changesets to release"

You need to create a changeset before the version can bump:
```bash
pnpm changeset
```

### Beta release didn't trigger

Check that:
1. `.changeset/pre.json` exists in the repo
2. There are pending changesets (`.changeset/*.md` files)
3. The PR was merged to `main`

### Wrong version format

- `0.2.0-beta.0` = You're in beta mode ✓
- `0.2.0-beta.20260120143022` = You used snapshots instead of prerelease mode

If you see datetime-based versions, you probably ran `version --snapshot` instead of entering pre mode properly.

### Need to undo a beta release

You can't unpublish from npm easily, but you can:
1. Create a new changeset with a fix
2. Release another beta (the higher version wins)

### VS Code extension not showing as pre-release

Make sure you're using `package:beta` or `release:beta` which includes the `--pre-release` flag.

---

## CI/CD Configuration

### Variables & Secrets

| Name | Type | Required? | Purpose |
|------|------|-----------|---------|
| `AUTO_BETA` | Variable | No | Set to `true` to enable auto-release on merge |
| `GITHUB_TOKEN` | Secret | Auto-provided | Used for GitHub releases |
| `NPM_TOKEN` | Secret | No | npm publish automation |

### Option A: Fully Manual (Default)

**No configuration needed.** CI does nothing on merge.

```bash
# After merging PR:
git checkout main && git pull
pnpm version              # Bump versions
pnpm release:beta         # Build and publish everything
git add -A && git commit -m "chore: release beta"
git push
```

This is the simplest setup - no tokens to manage, full control.

### Option B: Semi-Automated

Set `AUTO_BETA=true` in GitHub repo variables (Settings → Secrets and variables → Variables).

The workflow will:
- ✅ Bump versions automatically
- ✅ Build packages
- ✅ Create GitHub releases with VS Code extension
- ✅ Commit version changes
- ⏭️ Skip npm publish (no token)

After the workflow runs:
```bash
git pull                      # Get the version bump commit
pnpm release:beta:npm         # Publish to npm locally
```

### Option C: Fully Automated

Set both:
- `AUTO_BETA=true` (variable)
- `NPM_TOKEN` (secret) - from npmjs.com → Access Tokens → Automation type

The workflow does everything automatically on PR merge.

### Manual Trigger

Regardless of `AUTO_BETA` setting, you can always manually trigger the workflow:
- Go to Actions → Beta Release → Run workflow

This is useful for re-running a failed release or testing the workflow.

### Neovim Mirror (Manual Setup)

The Neovim sync currently requires manual push to the mirror repo. To fully automate:

1. Create a deploy key for the mirror repo
2. Add as `NVIM_MIRROR_DEPLOY_KEY` secret
3. Update the workflow to use the key for pushing

---

## Example: Complete Release Cycle

```bash
# === START NEW RELEASE CYCLE ===
pnpm beta:enter
git add .changeset/pre.json
git commit -m "chore: start v0.3.0 beta"
git push

# === FEATURE WORK ===
git checkout -b feature/dark-mode
# ... implement dark mode ...
pnpm changeset  # minor: "Add dark mode support"
git add -A && git commit -m "feat: dark mode"
git push -u origin feature/dark-mode
gh pr create --fill
# PR merged → Auto releases 0.3.0-beta.0

# === BUG FIX ===
git checkout main && git pull
git checkout -b fix/dark-mode-contrast
# ... fix contrast issue ...
pnpm changeset  # patch: "Fix dark mode contrast"
git add -A && git commit -m "fix: contrast in dark mode"
git push -u origin fix/dark-mode-contrast
gh pr create --fill
# PR merged → Auto releases 0.3.0-beta.1

# === STABLE RELEASE ===
git checkout main && git pull
pnpm beta:exit
pnpm version
git add -A && git commit -m "chore: release v0.3.0"
git push
pnpm release:stable
# 🎉 v0.3.0 is now stable!
```

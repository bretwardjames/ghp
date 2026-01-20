#!/bin/bash
# Sync apps/nvim to the ghp.nvim mirror repository
#
# Usage: ./scripts/sync-nvim-mirror.sh [--beta]
#
# Options:
#   --beta    Mark this as a beta release (adds [BETA] to commit, creates prerelease tag)
#
# Prerequisites:
# - Clone the mirror repo: git clone git@github.com:bretwardjames/ghp.nvim.git ../ghp.nvim-mirror
# - Or set GHP_NVIM_MIRROR to the mirror repo path

set -e

# Parse arguments
BETA_MODE=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --beta)
            BETA_MODE=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--beta]"
            exit 1
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONOREPO_ROOT="$(dirname "$SCRIPT_DIR")"
NVIM_SOURCE="$MONOREPO_ROOT/apps/nvim"
MIRROR_PATH="${GHP_NVIM_MIRROR:-$MONOREPO_ROOT/../ghp.nvim-mirror}"

if [ ! -d "$MIRROR_PATH/.git" ]; then
    echo "Error: Mirror repo not found at $MIRROR_PATH"
    echo "Clone it first: git clone git@github.com:bretwardjames/ghp.nvim.git $MIRROR_PATH"
    exit 1
fi

echo "Syncing apps/nvim -> $MIRROR_PATH"
if [ "$BETA_MODE" = true ]; then
    echo "Mode: BETA release"
fi

# Sync files (excluding .git)
rsync -av --delete --exclude='.git' "$NVIM_SOURCE/" "$MIRROR_PATH/"

# Show what changed
cd "$MIRROR_PATH"
git status

# Get version from the Lua plugin if it exists
VERSION=""
if [ -f "lua/ghp/init.lua" ]; then
    VERSION=$(grep -oP 'version\s*=\s*"\K[^"]+' lua/ghp/init.lua 2>/dev/null || echo "")
fi

echo ""
if [ "$BETA_MODE" = true ]; then
    COMMIT_MSG="[BETA] Sync from monorepo"
    if [ -n "$VERSION" ]; then
        TAG_NAME="v${VERSION}-beta"
        COMMIT_MSG="[BETA] Sync v${VERSION} from monorepo"
    fi
    echo "To commit and push (beta):"
    echo "  cd $MIRROR_PATH"
    echo "  git add -A"
    echo "  git commit -m '$COMMIT_MSG'"
    if [ -n "$VERSION" ]; then
        echo "  git tag -a $TAG_NAME -m 'Beta release $TAG_NAME'"
    fi
    echo "  git push && git push --tags"
else
    echo "To commit and push:"
    echo "  cd $MIRROR_PATH"
    echo "  git add -A"
    echo "  git commit -m 'Sync from monorepo'"
    echo "  git push"
fi

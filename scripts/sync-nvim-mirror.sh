#!/bin/bash
# Sync apps/nvim to the ghp.nvim mirror repository
#
# Usage: ./scripts/sync-nvim-mirror.sh
#
# Prerequisites:
# - Clone the mirror repo: git clone git@github.com:bretwardjames/ghp.nvim.git ../ghp.nvim-mirror
# - Or set GHP_NVIM_MIRROR to the mirror repo path

set -e

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

# Sync files (excluding .git)
rsync -av --delete --exclude='.git' "$NVIM_SOURCE/" "$MIRROR_PATH/"

# Show what changed
cd "$MIRROR_PATH"
git status

echo ""
echo "To commit and push:"
echo "  cd $MIRROR_PATH"
echo "  git add -A"
echo "  git commit -m 'Sync from monorepo'"
echo "  git push"

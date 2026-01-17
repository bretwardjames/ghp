#!/bin/bash
# GHP Tools Installer
# Installs the GitHub Projects CLI and Cursor extension

set -e

echo "🚀 Installing GHP Tools..."
echo ""

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Check for required tools
if ! command -v npm &> /dev/null; then
    echo "❌ npm is required but not installed."
    exit 1
fi

if ! command -v cursor &> /dev/null; then
    echo "⚠️  Cursor CLI not found. Skipping extension install."
    echo "   Install Cursor and run: cursor --install-extension <path-to-vsix>"
    SKIP_CURSOR=1
fi

# Install CLI
echo -e "${CYAN}📦 Installing ghp CLI...${NC}"
if npm install -g @bretwardjames/ghp-cli >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} CLI installed"
else
    echo -e "${DIM}(requires sudo)${NC}"
    sudo npm install -g @bretwardjames/ghp-cli
    echo -e "${GREEN}✓${NC} CLI installed"
fi
echo ""

# Install Cursor extension (must run as regular user, not root)
if [ -z "$SKIP_CURSOR" ]; then
    echo -e "${CYAN}🔌 Installing Cursor extension...${NC}"

    # Get latest release VSIX URL
    VSIX_URL=$(curl -s https://api.github.com/repos/bretwardjames/vscode-gh-projects/releases/latest | grep "browser_download_url.*vsix" | cut -d '"' -f 4)

    if [ -z "$VSIX_URL" ]; then
        echo "❌ Could not find latest VSIX release"
        exit 1
    fi

    # Download to temp file
    TEMP_VSIX=$(mktemp /tmp/gh-projects-XXXXXX.vsix)
    curl -sL "$VSIX_URL" -o "$TEMP_VSIX"
    chmod 644 "$TEMP_VSIX"

    # Install in Cursor (run as original user if we're root)
    if [ "$EUID" -eq 0 ] && [ -n "$SUDO_USER" ]; then
        sudo -u "$SUDO_USER" cursor --install-extension "$TEMP_VSIX"
    else
        cursor --install-extension "$TEMP_VSIX"
    fi

    # Cleanup
    rm "$TEMP_VSIX"

    echo -e "${GREEN}✓${NC} Cursor extension installed"
    echo ""
fi

# Setup instructions
echo -e "${GREEN}✅ Installation complete!${NC}"
echo ""
echo -e "${DIM}Next steps:${NC}"
echo "  1. Restart Cursor to activate the extension"
echo "  2. Run 'ghp auth' to authenticate with GitHub"
echo "  3. Run 'ghp work' to see your assigned issues"
echo ""

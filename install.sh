#!/bin/bash
# GHP Tools Installer
# Installs the GitHub Projects CLI and VS Code/Cursor extension

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

# Detect available editors (Cursor and/or VS Code)
EDITORS=()

# Check for Cursor
if command -v cursor &> /dev/null; then
    EDITORS+=("cursor")
else
    echo -e "${CYAN}🔍 Cursor CLI not found. Looking for Cursor app...${NC}"

    CURSOR_BIN=""
    if [[ "$OSTYPE" == "darwin"* ]]; then
        if [ -f "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" ]; then
            CURSOR_BIN="/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        for loc in "/opt/Cursor/resources/app/bin/cursor" "$HOME/.local/share/cursor/bin/cursor" "/usr/share/cursor/resources/app/bin/cursor"; do
            if [ -f "$loc" ]; then
                CURSOR_BIN="$loc"
                break
            fi
        done
    fi

    if [ -n "$CURSOR_BIN" ]; then
        echo -e "${DIM}Found Cursor at $CURSOR_BIN${NC}"
        echo -e "${DIM}Creating symlink...${NC}"
        sudo ln -sf "$CURSOR_BIN" /usr/local/bin/cursor
        echo -e "${GREEN}✓${NC} Cursor CLI installed"
        EDITORS+=("cursor")
    else
        echo -e "${DIM}Cursor not found${NC}"
    fi
fi

# Check for VS Code
if command -v code &> /dev/null; then
    EDITORS+=("code")
else
    echo -e "${DIM}VS Code CLI not found${NC}"
fi

if [ ${#EDITORS[@]} -eq 0 ]; then
    echo "⚠️  No supported editor found (Cursor or VS Code)."
    echo "   Install Cursor from https://cursor.sh or VS Code from https://code.visualstudio.com"
    echo "   Then run the install script again, or manually install:"
    echo "   cursor --install-extension bretwardjames.gh-projects"
    echo "   code --install-extension bretwardjames.gh-projects"
    SKIP_EXTENSION=1
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

# Install extension for each detected editor
if [ -z "$SKIP_EXTENSION" ]; then
    EXTENSION_ID="bretwardjames.gh-projects"
    VSIX_DOWNLOADED=0
    TEMP_VSIX=""

    for EDITOR in "${EDITORS[@]}"; do
        echo -e "${CYAN}🔌 Installing extension for ${EDITOR}...${NC}"

        INSTALLED=0

        # Try marketplace first
        echo -e "${DIM}Trying marketplace...${NC}"
        if [ "$EUID" -eq 0 ] && [ -n "$SUDO_USER" ]; then
            if sudo -u "$SUDO_USER" "$EDITOR" --install-extension "$EXTENSION_ID" 2>/dev/null; then
                INSTALLED=1
            fi
        else
            if "$EDITOR" --install-extension "$EXTENSION_ID" 2>/dev/null; then
                INSTALLED=1
            fi
        fi

        # Fall back to GitHub release if marketplace failed
        if [ "$INSTALLED" -eq 0 ]; then
            echo -e "${DIM}Marketplace not available, fetching from GitHub releases...${NC}"

            # Only download VSIX once
            if [ "$VSIX_DOWNLOADED" -eq 0 ]; then
                VSIX_URL=$(curl -s https://api.github.com/repos/bretwardjames/vscode-gh-projects/releases/latest | grep "browser_download_url.*vsix" | cut -d '"' -f 4)

                if [ -z "$VSIX_URL" ]; then
                    echo "❌ Could not find latest VSIX release"
                    exit 1
                fi

                TEMP_VSIX=$(mktemp /tmp/gh-projects-XXXXXX.vsix)
                curl -sL "$VSIX_URL" -o "$TEMP_VSIX"
                chmod 644 "$TEMP_VSIX"
                VSIX_DOWNLOADED=1
            fi

            # Install from VSIX
            if [ "$EUID" -eq 0 ] && [ -n "$SUDO_USER" ]; then
                sudo -u "$SUDO_USER" "$EDITOR" --install-extension "$TEMP_VSIX"
            else
                "$EDITOR" --install-extension "$TEMP_VSIX"
            fi
        fi

        echo -e "${GREEN}✓${NC} Extension installed for ${EDITOR}"
    done

    # Cleanup VSIX if downloaded
    if [ -n "$TEMP_VSIX" ] && [ -f "$TEMP_VSIX" ]; then
        rm "$TEMP_VSIX"
    fi

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

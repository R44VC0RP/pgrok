#!/bin/bash
set -euo pipefail

# ============================================================================
# pgrok installer — one-liner bootstrap
#
# Client (run first, on your Mac/Linux):
#   curl -fsSL https://raw.githubusercontent.com/R44VC0RP/pgrok/main/install.sh | bash -s client
#
# Server (run on VPS, paste the command from client setup):
#   curl -fsSL https://raw.githubusercontent.com/R44VC0RP/pgrok/main/install.sh | sudo bash -s server \
#     --domain example.com --email me@example.com --ssh-key "ssh-ed25519 AAAA..."
# ============================================================================

REPO="https://github.com/R44VC0RP/pgrok.git"
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

MODE="${1:-}"
shift || true

# --- Validate mode ---
if [[ "$MODE" != "server" && "$MODE" != "client" ]]; then
    echo ""
    echo -e "  ${BOLD}${GREEN}pgrok${NC} installer"
    echo -e "  ${DIM}Personal ngrok alternative${NC}"
    echo ""
    echo -e "  ${BOLD}Usage:${NC}"
    echo ""
    echo -e "  ${CYAN}1. Client (run first, on your Mac/Linux):${NC}"
    echo "     curl -fsSL https://raw.githubusercontent.com/R44VC0RP/pgrok/main/install.sh | bash -s client"
    echo ""
    echo -e "  ${CYAN}2. Server (run on VPS, paste command from client setup):${NC}"
    echo "     curl -fsSL https://raw.githubusercontent.com/R44VC0RP/pgrok/main/install.sh | sudo bash -s server [flags]"
    echo ""
    exit 1
fi

# --- Check for git ---
if ! command -v git &>/dev/null; then
    if [[ "$(uname)" == "Darwin" ]]; then
        echo "Git not found. Installing Xcode Command Line Tools..."
        xcode-select --install 2>/dev/null || true
        echo ""
        echo "Please re-run this command after Xcode CLT finishes installing."
        exit 1
    else
        echo "Error: git is required."
        echo "  Ubuntu/Debian: sudo apt install git"
        echo "  CentOS/RHEL:   sudo yum install git"
        exit 1
    fi
fi

# --- Clone location ---
if [[ "$MODE" == "server" ]]; then
    if [[ "$(id -u)" -ne 0 ]]; then
        echo "Error: server setup requires root. Use: sudo bash -s server ..."
        exit 1
    fi
    CLONE_DIR="/opt/pgrok/repo"
else
    CLONE_DIR="${HOME}/.pgrok/repo"
fi

mkdir -p "$(dirname "$CLONE_DIR")"

# --- Clone or update ---
if [[ -d "$CLONE_DIR/.git" ]]; then
    echo -e "  ${CYAN}>${NC} Updating pgrok..."
    git -C "$CLONE_DIR" pull --ff-only 2>/dev/null || git -C "$CLONE_DIR" fetch --all
else
    echo -e "  ${CYAN}>${NC} Downloading pgrok..."
    rm -rf "$CLONE_DIR"
    git clone --depth 1 "$REPO" "$CLONE_DIR"
fi

# --- Run setup ---
cd "$CLONE_DIR"
exec bash setup.sh "$MODE" "$@"

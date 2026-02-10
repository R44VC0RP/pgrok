#!/bin/bash
set -euo pipefail

# ============================================================================
# pgrok setup — Interactive installer for personal ngrok alternative
#
# Usage:
#   ./setup.sh client                          Interactive client setup (run first)
#   ./setup.sh client --rebuild                Rebuild binary from existing config
#   ./setup.sh server                          Interactive server setup
#   ./setup.sh server --domain X --email Y --ssh-key "Z"   Non-interactive server
# ============================================================================

VERSION="0.1.0"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# --- Helpers ---
info()    { echo -e "  ${CYAN}>${NC} $*"; }
success() { echo -e "  ${GREEN}✓${NC} $*"; }
warn()    { echo -e "  ${YELLOW}!${NC} $*"; }
fail()    { echo -e "  ${RED}✗${NC} $*"; exit 1; }

prompt() {
    local var_name="$1"
    local prompt_text="$2"
    local default="${3:-}"
    local value

    if [ -n "$default" ]; then
        echo -en "  ${BOLD}${prompt_text}${NC} ${DIM}[${default}]${NC}: "
    else
        echo -en "  ${BOLD}${prompt_text}${NC}: "
    fi
    read -r value
    value="${value:-$default}"

    if [ -z "$value" ]; then
        fail "Value required."
    fi

    eval "$var_name=\"$value\""
}

prompt_yn() {
    local prompt_text="$1"
    local default="${2:-y}"
    local yn

    if [ "$default" = "y" ]; then
        echo -en "  ${BOLD}${prompt_text}${NC} ${DIM}[Y/n]${NC}: "
    else
        echo -en "  ${BOLD}${prompt_text}${NC} ${DIM}[y/N]${NC}: "
    fi
    read -r yn
    yn="${yn:-$default}"

    [[ "$yn" =~ ^[Yy] ]]
}

banner() {
    echo ""
    echo -e "  ${BOLD}${GREEN}pgrok${NC} v${VERSION}"
    echo -e "  ${DIM}Personal ngrok alternative${NC}"
    echo ""
}

# Copy text to clipboard (best-effort, silent fail)
copy_to_clipboard() {
    local text="$1"
    if command -v pbcopy &>/dev/null; then
        printf '%s' "$text" | pbcopy
        return 0
    elif command -v xclip &>/dev/null; then
        printf '%s' "$text" | xclip -selection clipboard
        return 0
    elif command -v xsel &>/dev/null; then
        printf '%s' "$text" | xsel --clipboard
        return 0
    fi
    return 1
}

# ============================================================================
# SERVER SETUP
# ============================================================================
setup_server() {
    shift  # remove "server" from args

    # --- Parse CLI flags ---
    DOMAIN=""
    ACME_EMAIL=""
    SSH_PUB_KEY=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --domain)   DOMAIN="$2"; shift 2 ;;
            --email)    ACME_EMAIL="$2"; shift 2 ;;
            --ssh-key)  SSH_PUB_KEY="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    banner
    echo -e "  ${BOLD}Server Setup${NC}"
    echo -e "  ${DIM}Setting up the pgrok tunnel server on this VPS.${NC}"
    echo ""

    # --- Check prerequisites ---
    echo -e "  ${BOLD}Checking prerequisites...${NC}"

    if [ "$(id -u)" -ne 0 ]; then
        fail "This script must be run as root (use sudo)"
    fi

    if ! command -v docker &>/dev/null; then
        fail "Docker is not installed. Install it first: https://docs.docker.com/engine/install/"
    fi
    success "Docker installed"

    if ! docker compose version &>/dev/null 2>&1; then
        fail "Docker Compose is not available. Install it first."
    fi
    success "Docker Compose available"

    if ! command -v python3 &>/dev/null; then
        fail "Python 3 is not installed. Install it first."
    fi
    success "Python 3 installed"

    echo ""

    # --- Gather configuration (prompt for anything not provided via flags) ---
    echo -e "  ${BOLD}Configuration${NC}"
    echo ""

    if [ -z "$DOMAIN" ]; then
        prompt DOMAIN "Your domain (e.g. example.com)"
    else
        success "Domain: ${DOMAIN}"
    fi

    if [ -z "$ACME_EMAIL" ]; then
        prompt ACME_EMAIL "Email for SSL certificates (Let's Encrypt / ZeroSSL)"
    else
        success "Email: ${ACME_EMAIL}"
    fi

    if [ -z "$SSH_PUB_KEY" ]; then
        echo ""
        info "Your client's SSH public key is needed so pgrok can connect."
        info "Find it on your Mac/Linux with: cat ~/.ssh/id_ed25519.pub"
        echo ""
        prompt SSH_PUB_KEY "Client SSH public key (paste the full line)"
    else
        success "SSH key: ${SSH_PUB_KEY:0:40}..."
    fi

    VPS_IP=$(curl -s --connect-timeout 5 ifconfig.me 2>/dev/null || echo "")

    # --- Summary (only in interactive mode) ---
    if [ -t 0 ]; then
        echo ""
        echo -e "  ${BOLD}Summary${NC}"
        echo -e "  ${DIM}────────────────────────────────────${NC}"
        echo -e "  Domain:     ${CYAN}*.${DOMAIN}${NC}"
        echo -e "  Email:      ${CYAN}${ACME_EMAIL}${NC}"
        echo -e "  VPS IP:     ${CYAN}${VPS_IP:-unknown}${NC}"
        echo -e "  SSH key:    ${CYAN}${SSH_PUB_KEY:0:40}...${NC}"
        echo -e "  ${DIM}────────────────────────────────────${NC}"
        echo ""

        if ! prompt_yn "Proceed with installation?"; then
            echo "  Aborted."
            exit 0
        fi
    fi

    echo ""
    echo -e "  ${BOLD}Installing...${NC}"
    echo ""

    # --- 1. Create server directory ---
    SERVER_DIR="/opt/pgrok"
    mkdir -p "$SERVER_DIR"
    success "Created ${SERVER_DIR}"

    # --- 2. Copy server files ---
    cp "${SCRIPT_DIR}/server/Dockerfile" "$SERVER_DIR/"
    cp "${SCRIPT_DIR}/server/docker-compose.yml" "$SERVER_DIR/"
    success "Copied Docker files"

    # --- 3. Generate Caddyfile ---
    cat > "${SERVER_DIR}/Caddyfile" << CADDYEOF
{
	on_demand_tls {
		ask http://localhost:9123/check
	}
	email ${ACME_EMAIL}
}

https:// {
	tls {
		on_demand
		issuer acme
		issuer acme {
			dir https://acme.zerossl.com/v2/DV90
		}
	}
}
CADDYEOF
    success "Generated Caddyfile (on-demand TLS with Let's Encrypt + ZeroSSL fallback)"

    # --- 4. Install pgrok-ask service ---
    ASK_SCRIPT="/usr/local/bin/pgrok-ask"
    sed "s/yourdomain\.com/${DOMAIN}/g" "${SCRIPT_DIR}/server/pgrok-ask" > "$ASK_SCRIPT"
    chmod +x "$ASK_SCRIPT"

    sed "s/yourdomain\.com/${DOMAIN}/g" "${SCRIPT_DIR}/server/pgrok-ask.service" > /etc/systemd/system/pgrok-ask.service
    systemctl daemon-reload
    systemctl enable pgrok-ask
    systemctl restart pgrok-ask
    success "Installed and started pgrok-ask service"

    # --- 5. Install pgrok-tunnel with correct domain ---
    TUNNEL_SCRIPT="/usr/local/bin/pgrok-tunnel"
    sed "s/yourdomain\.com/${DOMAIN}/g" "${SCRIPT_DIR}/server/pgrok-tunnel" > "$TUNNEL_SCRIPT"
    chmod +x "$TUNNEL_SCRIPT"
    success "Installed pgrok-tunnel to ${TUNNEL_SCRIPT}"

    # --- 6. Create pgrok SSH user ---
    PGROK_USER="pgrok"
    if id "$PGROK_USER" &>/dev/null; then
        success "User '${PGROK_USER}' already exists"
    else
        useradd -m -s /bin/bash "$PGROK_USER"
        success "Created user '${PGROK_USER}'"
    fi

    SSH_DIR="/home/${PGROK_USER}/.ssh"
    AUTH_KEYS="${SSH_DIR}/authorized_keys"
    mkdir -p "$SSH_DIR"

    if grep -qF "$SSH_PUB_KEY" "$AUTH_KEYS" 2>/dev/null; then
        success "SSH key already authorized"
    else
        echo "$SSH_PUB_KEY" >> "$AUTH_KEYS"
        success "Added SSH key to authorized_keys"
    fi

    chown -R "${PGROK_USER}:${PGROK_USER}" "$SSH_DIR"
    chmod 700 "$SSH_DIR"
    chmod 600 "$AUTH_KEYS"

    # --- 7. Configure sshd ---
    SSHD_CONFIG="/etc/ssh/sshd_config"
    PGROK_MARKER="# pgrok tunnel configuration"

    if grep -q "$PGROK_MARKER" "$SSHD_CONFIG" 2>/dev/null; then
        success "sshd already configured for pgrok"
    else
        cat >> "$SSHD_CONFIG" << 'SSHDEOF'

# pgrok tunnel configuration
Match User pgrok
    AllowTcpForwarding remote
    GatewayPorts no
    X11Forwarding no
    PermitTTY yes
SSHDEOF
        success "Configured sshd for pgrok user"

        if systemctl is-active --quiet sshd 2>/dev/null; then
            systemctl restart sshd
            success "Restarted sshd"
        elif systemctl is-active --quiet ssh 2>/dev/null; then
            systemctl restart ssh
            success "Restarted ssh"
        else
            warn "Could not restart sshd. Please restart it manually."
        fi
    fi

    # --- 8. Start Caddy ---
    echo ""
    info "Starting Caddy..."
    echo ""

    if (cd "$SERVER_DIR" && docker compose up -d --build) ; then
        echo ""
        success "Caddy is running"
    else
        echo ""
        fail "Failed to start Caddy. Check docker compose logs in ${SERVER_DIR}"
    fi

    # --- Done ---
    echo ""
    echo -e "  ${BOLD}${GREEN}Server setup complete!${NC}"
    echo ""
    echo -e "  Go back to your Mac and run:"
    echo ""
    echo -e "    ${CYAN}pgrok myapp 4000${NC}"
    echo -e "    ${DIM}# → https://myapp.${DOMAIN} → localhost:4000${NC}"
    echo ""
}

# ============================================================================
# CLIENT SETUP
# ============================================================================
setup_client() {
    shift  # remove "client" from args

    # --- Parse CLI flags ---
    PGROK_HOST=""
    PGROK_DOMAIN=""
    PGROK_EMAIL=""
    REBUILD_MODE=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --server)   PGROK_HOST="$2"; shift 2 ;;
            --domain)   PGROK_DOMAIN="$2"; shift 2 ;;
            --email)    PGROK_EMAIL="$2"; shift 2 ;;
            --rebuild)  REBUILD_MODE=true; shift ;;
            *) shift ;;
        esac
    done

    banner

    CONFIG_DIR="${HOME}/.pgrok"
    CONFIG_FILE="${CONFIG_DIR}/config"

    # --- Rebuild mode: skip prompts, reuse existing config ---
    if [ "$REBUILD_MODE" = true ]; then
        echo -e "  ${BOLD}Rebuild Mode${NC}"
        echo -e "  ${DIM}Rebuilding pgrok binary from existing config.${NC}"
        echo ""

        if [ ! -f "$CONFIG_FILE" ]; then
            fail "No config found at ${CONFIG_FILE}. Run setup without --rebuild first."
        fi

        # shellcheck source=/dev/null
        source "$CONFIG_FILE"
        success "Loaded config from ${CONFIG_FILE}"
        echo ""
    else
        echo -e "  ${BOLD}Client Setup${NC}"
        echo -e "  ${DIM}Install the pgrok command on your Mac/Linux.${NC}"
        echo ""

        # --- Gather configuration ---
        echo -e "  ${BOLD}Configuration${NC}"
        echo ""

        if [ -z "$PGROK_HOST" ]; then
            prompt PGROK_HOST "VPS hostname or IP address"
        else
            success "Server: ${PGROK_HOST}"
        fi

        if [ -z "$PGROK_DOMAIN" ]; then
            prompt PGROK_DOMAIN "Your domain (e.g. example.com)"
        else
            success "Domain: ${PGROK_DOMAIN}"
        fi

        if [ -z "$PGROK_EMAIL" ]; then
            prompt PGROK_EMAIL "Email for SSL certificates"
        else
            success "Email: ${PGROK_EMAIL}"
        fi

        prompt PGROK_USER "SSH user on VPS" "pgrok"

        # --- Detect SSH key ---
        DEFAULT_KEY=""
        for key_file in ~/.ssh/id_ed25519 ~/.ssh/id_rsa ~/.ssh/id_ecdsa; do
            if [ -f "$key_file" ]; then
                DEFAULT_KEY="$key_file"
                break
            fi
        done

        PGROK_SSH_KEY=""
        if [ -n "$DEFAULT_KEY" ]; then
            if prompt_yn "Use SSH key ${DEFAULT_KEY}?"; then
                PGROK_SSH_KEY="$DEFAULT_KEY"
            fi
        fi

        if [ -z "$PGROK_SSH_KEY" ]; then
            echo ""
            prompt PGROK_SSH_KEY "Path to SSH private key" "${DEFAULT_KEY}"
        fi

        # Read the public key for the server command
        EXPANDED_KEY="${PGROK_SSH_KEY/#\~/$HOME}"
        PUB_KEY_FILE="${EXPANDED_KEY}.pub"
        if [ -f "$PUB_KEY_FILE" ]; then
            SSH_PUB_KEY=$(cat "$PUB_KEY_FILE")
        else
            warn "Could not find public key at ${PUB_KEY_FILE}"
            prompt SSH_PUB_KEY "Paste your SSH public key"
        fi

        echo ""

        # --- Summary ---
        echo -e "  ${BOLD}Summary${NC}"
        echo -e "  ${DIM}────────────────────────────────────${NC}"
        echo -e "  VPS host:   ${CYAN}${PGROK_HOST}${NC}"
        echo -e "  Domain:     ${CYAN}${PGROK_DOMAIN}${NC}"
        echo -e "  Email:      ${CYAN}${PGROK_EMAIL}${NC}"
        echo -e "  SSH user:   ${CYAN}${PGROK_USER}${NC}"
        echo -e "  SSH key:    ${CYAN}${PGROK_SSH_KEY}${NC}"
        echo -e "  ${DIM}────────────────────────────────────${NC}"
        echo ""

        if ! prompt_yn "Install pgrok?"; then
            echo "  Aborted."
            exit 0
        fi

        echo ""

        # --- 1. Write config ---
        mkdir -p "$CONFIG_DIR"

        cat > "$CONFIG_FILE" << CFGEOF
# pgrok client configuration
# Generated by setup.sh on $(date)

PGROK_HOST=${PGROK_HOST}
PGROK_DOMAIN=${PGROK_DOMAIN}
PGROK_USER=${PGROK_USER}
CFGEOF

        if [ -n "$PGROK_SSH_KEY" ]; then
            echo "PGROK_SSH_KEY=${PGROK_SSH_KEY}" >> "$CONFIG_FILE"
        fi

        chmod 600 "$CONFIG_FILE"
        success "Wrote config to ${CONFIG_FILE}"
    fi

    echo -e "  ${BOLD}Installing...${NC}"
    echo ""

    # --- 2. Build and install pgrok TUI client ---
    TUI_DIR="${SCRIPT_DIR}/client/tui"

    if ! command -v bun &>/dev/null; then
        info "Bun is required for the pgrok TUI client."
        info "Installing Bun..."
        curl -fsSL https://bun.sh/install | bash
        export PATH="$HOME/.bun/bin:$PATH"
        if ! command -v bun &>/dev/null; then
            fail "Failed to install Bun. Install manually: https://bun.sh"
        fi
        success "Bun installed"
    else
        success "Bun $(bun --version) found"
    fi

    info "Installing dependencies..."
    (cd "$TUI_DIR" && bun install --frozen-lockfile 2>/dev/null || bun install)
    success "Dependencies installed"

    info "Building pgrok binary..."
    (cd "$TUI_DIR" && bun build --compile --target=bun index.ts --outfile pgrok)
    success "Built pgrok binary"

    INSTALL_DIR="/usr/local/bin"
    PGROK_BIN="${INSTALL_DIR}/pgrok"

    if [ -w "$INSTALL_DIR" ]; then
        cp "${TUI_DIR}/pgrok" "$PGROK_BIN"
        chmod +x "$PGROK_BIN"
        success "Installed pgrok to ${PGROK_BIN}"
    else
        info "Need sudo to install to ${INSTALL_DIR}"
        sudo cp "${TUI_DIR}/pgrok" "$PGROK_BIN"
        sudo chmod +x "$PGROK_BIN"
        success "Installed pgrok to ${PGROK_BIN}"
    fi

    # --- Done ---
    echo ""
    echo -e "  ${BOLD}${GREEN}Client installed!${NC}"
    echo ""

    # --- Print server setup command (skip in rebuild mode) ---
    if [ "$REBUILD_MODE" = false ]; then
        INSTALL_URL="https://raw.githubusercontent.com/R44VC0RP/pgrok/main/install.sh"

        # Build the server command
        SERVER_CMD="curl -fsSL ${INSTALL_URL} | sudo bash -s server --domain ${PGROK_DOMAIN} --email ${PGROK_EMAIL} --ssh-key \"${SSH_PUB_KEY}\""

        echo -e "  ${BOLD}Next: set up your server.${NC}"
        echo -e "  ${DIM}SSH into your VPS and paste this command:${NC}"
        echo ""

        # Try to copy to clipboard
        if copy_to_clipboard "$SERVER_CMD"; then
            echo -e "  ${GREEN}✓ Copied to clipboard!${NC}"
            echo ""
        fi

        echo -e "  ${CYAN}${SERVER_CMD}${NC}"
        echo ""
        echo -e "  ${DIM}After the server is set up, come back and run:${NC}"
        echo ""
        echo -e "    ${CYAN}pgrok myapp 4000${NC}"
        echo -e "    ${DIM}# → https://myapp.${PGROK_DOMAIN} → localhost:4000${NC}"
        echo ""
    else
        echo -e "  ${BOLD}Usage:${NC}"
        echo ""
        echo -e "    ${CYAN}pgrok myapp 4000${NC}"
        echo -e "    ${DIM}# → https://myapp.${PGROK_DOMAIN:-yourdomain.com} → localhost:4000${NC}"
        echo ""
    fi
}

# ============================================================================
# MAIN
# ============================================================================

case "${1:-}" in
    server)
        setup_server "$@"
        ;;
    client)
        setup_client "$@"
        ;;
    --version|-v)
        echo "pgrok v${VERSION}"
        ;;
    *)
        banner
        echo -e "  ${BOLD}Usage:${NC}"
        echo ""
        echo -e "    ${CYAN}./setup.sh client${NC}    Install the Mac/Linux client (run first)"
        echo -e "    ${CYAN}./setup.sh server${NC}    Set up the VPS tunnel server"
        echo ""
        exit 1
        ;;
esac

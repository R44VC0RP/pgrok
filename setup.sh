#!/bin/bash
set -euo pipefail

# ============================================================================
# pgrok setup — Interactive installer for personal ngrok alternative
#
# Usage:
#   ./setup.sh server    Set up the VPS (run on your server)
#   ./setup.sh client    Set up the Mac client (run on your Mac)
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

prompt_secret() {
    local var_name="$1"
    local prompt_text="$2"
    local value

    echo -en "  ${BOLD}${prompt_text}${NC}: "
    read -rs value
    echo ""

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

# ============================================================================
# SERVER SETUP
# ============================================================================
setup_server() {
    banner
    echo -e "  ${BOLD}Server Setup${NC}"
    echo -e "  ${DIM}Run this on your VPS to set up the tunnel server.${NC}"
    echo ""

    # --- Check prerequisites ---
    echo -e "  ${BOLD}Checking prerequisites...${NC}"

    if [ "$(id -u)" -ne 0 ]; then
        fail "This script must be run as root (use sudo ./setup.sh server)"
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

    # --- Gather configuration ---
    echo -e "  ${BOLD}Configuration${NC}"
    echo ""

    prompt DOMAIN "Your domain (e.g. example.com)"

    echo ""
    info "Your Mac's SSH public key is needed so the pgrok client can connect."
    info "Find it on your Mac with: cat ~/.ssh/id_ed25519.pub"
    echo ""
    prompt SSH_PUB_KEY "Mac SSH public key (paste the full line)"

    VPS_IP=$(curl -s --connect-timeout 5 ifconfig.me 2>/dev/null || echo "")
    echo ""
    if [ -n "$VPS_IP" ]; then
        info "Detected VPS IP: ${VPS_IP}"
    fi

    echo ""
    echo -e "  ${BOLD}Summary${NC}"
    echo -e "  ${DIM}────────────────────────────────────${NC}"
    echo -e "  Domain:     ${CYAN}*.${DOMAIN}${NC}"
    echo -e "  VPS IP:     ${CYAN}${VPS_IP:-unknown}${NC}"
    echo -e "  SSH key:    ${CYAN}${SSH_PUB_KEY:0:40}...${NC}"
    echo -e "  ${DIM}────────────────────────────────────${NC}"
    echo ""

    if ! prompt_yn "Proceed with installation?"; then
        echo "  Aborted."
        exit 0
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
    cat > "${SERVER_DIR}/Caddyfile" << 'CADDYEOF'
{
	on_demand_tls {
		ask http://localhost:9123/check
	}
}

https:// {
	tls {
		on_demand
	}
}
CADDYEOF
    success "Generated Caddyfile (on-demand TLS)"

    # --- 4. Install pgrok-ask service ---
    ASK_SCRIPT="/usr/local/bin/pgrok-ask"
    sed "s/yourdomain\.com/${DOMAIN}/g" "${SCRIPT_DIR}/server/pgrok-ask" > "$ASK_SCRIPT"
    chmod +x "$ASK_SCRIPT"

    # Create systemd service for pgrok-ask
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
    info "Starting Caddy (using stock image, no custom build needed)..."
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
    echo -e "  ${BOLD}One manual step remaining — add DNS record:${NC}"
    echo ""
    echo -e "  In your Vercel dashboard (vercel.com → Domains → ${DOMAIN} → DNS Records):"
    echo ""
    echo -e "    Type:  ${BOLD}A${NC}"
    echo -e "    Name:  ${BOLD}*${NC}"
    echo -e "    Value: ${BOLD}${VPS_IP:-<your-vps-ip>}${NC}"
    echo ""
    echo -e "  Then run ${CYAN}./setup.sh client${NC} on your Mac."
    echo ""
}

# ============================================================================
# CLIENT SETUP
# ============================================================================
setup_client() {
    banner
    echo -e "  ${BOLD}Client Setup${NC}"
    echo -e "  ${DIM}Run this on your Mac to install the pgrok command.${NC}"
    echo ""

    # --- Gather configuration ---
    echo -e "  ${BOLD}Configuration${NC}"
    echo ""

    prompt PGROK_HOST "VPS hostname or IP address"
    prompt PGROK_DOMAIN "Your domain (e.g. example.com)"
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

    echo ""

    # --- Test SSH connection ---
    if prompt_yn "Test SSH connection to ${PGROK_USER}@${PGROK_HOST}?" "y"; then
        echo ""
        info "Testing SSH connection..."

        SSH_TEST_OPTS=(-o ConnectTimeout=10 -o BatchMode=yes)
        if [ -n "$PGROK_SSH_KEY" ]; then
            EXPANDED_KEY="${PGROK_SSH_KEY/#\~/$HOME}"
            SSH_TEST_OPTS+=(-i "$EXPANDED_KEY")
        fi

        if ssh "${SSH_TEST_OPTS[@]}" "${PGROK_USER}@${PGROK_HOST}" "echo ok" &>/dev/null; then
            success "SSH connection works"
        else
            warn "SSH connection failed. Make sure:"
            warn "  1. The server setup is complete"
            warn "  2. Your SSH key is in the pgrok user's authorized_keys"
            warn "  3. The VPS hostname/IP is correct"
            echo ""
            if ! prompt_yn "Continue anyway?"; then
                exit 1
            fi
        fi
        echo ""
    fi

    # --- Summary ---
    echo -e "  ${BOLD}Summary${NC}"
    echo -e "  ${DIM}────────────────────────────────────${NC}"
    echo -e "  VPS host:   ${CYAN}${PGROK_HOST}${NC}"
    echo -e "  Domain:     ${CYAN}${PGROK_DOMAIN}${NC}"
    echo -e "  SSH user:   ${CYAN}${PGROK_USER}${NC}"
    echo -e "  SSH key:    ${CYAN}${PGROK_SSH_KEY:-default}${NC}"
    echo -e "  ${DIM}────────────────────────────────────${NC}"
    echo ""

    if ! prompt_yn "Install pgrok?"; then
        echo "  Aborted."
        exit 0
    fi

    echo ""
    echo -e "  ${BOLD}Installing...${NC}"
    echo ""

    # --- 1. Write config ---
    CONFIG_DIR="${HOME}/.pgrok"
    CONFIG_FILE="${CONFIG_DIR}/config"
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

    # --- 2. Install pgrok command ---
    INSTALL_DIR="/usr/local/bin"
    PGROK_BIN="${INSTALL_DIR}/pgrok"

    if [ -w "$INSTALL_DIR" ]; then
        cp "${SCRIPT_DIR}/client/pgrok" "$PGROK_BIN"
        chmod +x "$PGROK_BIN"
        success "Installed pgrok to ${PGROK_BIN}"
    else
        info "Need sudo to install to ${INSTALL_DIR}"
        sudo cp "${SCRIPT_DIR}/client/pgrok" "$PGROK_BIN"
        sudo chmod +x "$PGROK_BIN"
        success "Installed pgrok to ${PGROK_BIN}"
    fi

    # --- Done ---
    echo ""
    echo -e "  ${BOLD}${GREEN}Client setup complete!${NC}"
    echo ""
    echo -e "  ${BOLD}Usage:${NC}"
    echo ""
    echo -e "    ${CYAN}pgrok myapp 4000${NC}"
    echo -e "    ${DIM}# → https://myapp.${PGROK_DOMAIN} → localhost:4000${NC}"
    echo ""
    echo -e "    ${CYAN}pgrok api 3000${NC}"
    echo -e "    ${DIM}# → https://api.${PGROK_DOMAIN} → localhost:3000${NC}"
    echo ""
}

# ============================================================================
# MAIN
# ============================================================================

case "${1:-}" in
    server)
        setup_server
        ;;
    client)
        setup_client
        ;;
    --version|-v)
        echo "pgrok v${VERSION}"
        ;;
    *)
        banner
        echo -e "  ${BOLD}Usage:${NC}"
        echo ""
        echo -e "    ${CYAN}./setup.sh server${NC}    Set up the VPS tunnel server"
        echo -e "    ${CYAN}./setup.sh client${NC}    Install the Mac client"
        echo ""
        exit 1
        ;;
esac

#!/bin/bash
set -euo pipefail

# pgrok VPS Setup Script
# Run this on your VPS to set up the tunnel server.
#
# Prerequisites:
#   - Docker and Docker Compose installed
#   - Root or sudo access
#   - Your Mac's SSH public key (passed as argument or pasted when prompted)
#
# Usage:
#   sudo ./setup-vps.sh [your-ssh-public-key]

PGROK_USER="pgrok"
PGROK_HOME="/home/${PGROK_USER}"
TUNNEL_SCRIPT="/usr/local/bin/pgrok-tunnel"

echo "=== pgrok VPS Setup ==="
echo ""

# --- 1. Create pgrok user ---
if id "$PGROK_USER" &>/dev/null; then
    echo "[ok] User '${PGROK_USER}' already exists"
else
    echo "[+] Creating user '${PGROK_USER}'..."
    useradd -m -s /bin/bash "$PGROK_USER"
    echo "[ok] User created"
fi

# --- 2. Set up SSH key ---
SSH_DIR="${PGROK_HOME}/.ssh"
AUTH_KEYS="${SSH_DIR}/authorized_keys"

mkdir -p "$SSH_DIR"

if [ -n "${1:-}" ]; then
    SSH_PUB_KEY="$1"
else
    echo ""
    echo "Paste your Mac's SSH public key (from ~/.ssh/id_ed25519.pub or ~/.ssh/id_rsa.pub):"
    read -r SSH_PUB_KEY
fi

if [ -n "$SSH_PUB_KEY" ]; then
    # Append if not already present
    if grep -qF "$SSH_PUB_KEY" "$AUTH_KEYS" 2>/dev/null; then
        echo "[ok] SSH key already in authorized_keys"
    else
        echo "$SSH_PUB_KEY" >> "$AUTH_KEYS"
        echo "[ok] SSH key added"
    fi
fi

chown -R "${PGROK_USER}:${PGROK_USER}" "$SSH_DIR"
chmod 700 "$SSH_DIR"
chmod 600 "$AUTH_KEYS"

# --- 3. Install pgrok-tunnel script ---
echo "[+] Installing pgrok-tunnel to ${TUNNEL_SCRIPT}..."
cp "$(dirname "$0")/pgrok-tunnel" "$TUNNEL_SCRIPT"
chmod +x "$TUNNEL_SCRIPT"
echo "[ok] Tunnel script installed"

# --- 4. Configure sshd ---
SSHD_CONFIG="/etc/ssh/sshd_config"
PGROK_SSHD_MARKER="# pgrok tunnel configuration"

if grep -q "$PGROK_SSHD_MARKER" "$SSHD_CONFIG" 2>/dev/null; then
    echo "[ok] sshd already configured for pgrok"
else
    echo "[+] Adding pgrok SSH configuration..."
    cat >> "$SSHD_CONFIG" << 'SSHD_EOF'

# pgrok tunnel configuration
Match User pgrok
    AllowTcpForwarding remote
    GatewayPorts no
    X11Forwarding no
    PermitTTY yes
SSHD_EOF
    echo "[ok] sshd configured"

    echo "[+] Restarting sshd..."
    if systemctl is-active --quiet sshd; then
        systemctl restart sshd
    elif systemctl is-active --quiet ssh; then
        systemctl restart ssh
    else
        echo "[warn] Could not restart sshd automatically. Please restart it manually."
    fi
    echo "[ok] sshd restarted"
fi

# --- 5. Check Docker ---
if command -v docker &>/dev/null; then
    echo "[ok] Docker is installed"
else
    echo "[!!] Docker is not installed. Please install Docker first."
    echo "     https://docs.docker.com/engine/install/"
    exit 1
fi

if command -v docker compose &>/dev/null || docker compose version &>/dev/null 2>&1; then
    echo "[ok] Docker Compose is available"
else
    echo "[!!] Docker Compose is not available. Please install it."
    exit 1
fi

# --- 6. Summary ---
echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Copy .env.example to .env and set your CLOUDFLARE_API_TOKEN"
echo "  2. Edit Caddyfile — replace 'yourdomain.com' with your actual domain"
echo "  3. Edit pgrok-tunnel — replace 'yourdomain.com' with your actual domain"
echo "  4. Run: docker compose up -d --build"
echo "  5. Add wildcard DNS: *.yourdomain.com → A → $(curl -s ifconfig.me || echo '<this-vps-ip>') (Cloudflare proxy OFF)"
echo ""

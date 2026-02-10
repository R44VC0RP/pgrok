# pgrok

Personal ngrok alternative. Expose local ports to the internet with automatic HTTPS, an interactive TUI dashboard, and HTTP request inspection — all through your own VPS.

<img width="984" height="884" alt="image" src="https://github.com/user-attachments/assets/e28b2da4-23f3-4689-b1a6-d72bd53c3396" />

## How it works

```
Browser -> https://myapp.yourdomain.com
        -> DNS wildcard A record -> VPS
        -> Caddy terminates TLS (on-demand cert via Let's Encrypt + ZeroSSL fallback)
        -> Caddy reverse proxies to SSH tunnel port
        -> SSH tunnel forwards to your Mac
        -> local proxy (captures request logs for TUI)
        -> localhost:4000
```

- **Caddy** on the VPS handles HTTPS with on-demand TLS -- certs are auto-provisioned per subdomain. Falls back to ZeroSSL if Let's Encrypt is rate-limited.
- **SSH reverse tunnels** carry traffic -- no extra tunnel software.
- A small **Python script** on the server dynamically configures Caddy routes when tunnels connect/disconnect.
- The **TUI client** (built with [OpenTUI](https://opentui.com)) provides a live dashboard with request inspection, connection stats, and color-coded HTTP logs.

## Quick Start

### 1. Server (on your VPS)

```bash
git clone https://github.com/R44VC0RP/pgrok.git ~/pgrok
cd ~/pgrok
sudo ./setup.sh server
```

You'll be prompted for:
- Your domain name
- An email for ACME cert registration
- Your Mac's SSH public key

The script automatically:
- Starts stock Caddy via Docker (no custom build needed)
- Configures on-demand TLS with Let's Encrypt + ZeroSSL fallback
- Installs the `pgrok-ask` cert validation service
- Installs the `pgrok-tunnel` route controller
- Creates a `pgrok` SSH user with your key
- Configures sshd for secure tunnel forwarding

### 2. DNS

Add one wildcard A record pointing to your VPS (the setup script prints the exact record):

| Type | Name | Value |
|------|------|-------|
| A    | *    | `<your-vps-ip>` |

Works with any DNS provider (Vercel, Cloudflare, etc). Just point `*.yourdomain.com` at your VPS.

### 3. Client (on your Mac)

```bash
cd ~/pgrok
./setup.sh client
```

You'll be prompted for:
- VPS hostname/IP
- Your domain
- SSH user (defaults to `pgrok`)

The script:
- Writes `~/.pgrok/config` with your settings
- Installs [Bun](https://bun.sh) if not present
- Builds the pgrok TUI binary
- Installs `pgrok` to `/usr/local/bin`
- Optionally tests the SSH connection

**Quick re-install** (skip prompts if config already exists):

```bash
./setup.sh client --rebuild
```

## Usage

```bash
# Expose a local dev server
pgrok myapp 4000
# -> https://myapp.yourdomain.com

# Expose an API
pgrok api 3000
# -> https://api.yourdomain.com

# Any subdomain works instantly
pgrok staging 8080
# -> https://staging.yourdomain.com

# Debug mode -- dumps raw tunnel logs on exit
pgrok myapp 4000 --print-logs
```

Press `Ctrl+C` to stop. The route is cleaned up automatically.

### TUI Dashboard

The dashboard shows in real-time:

- **Session Status** -- connecting / provisioning TLS / online / error
- **Forwarding** -- your public URL and local port
- **TLS Certificate** -- provisioning status (Let's Encrypt)
- **Connection Stats** -- total requests, open connections, request rates (1m/5m), response time percentiles (p50/p90)
- **HTTP Request Log** -- scrollable, color-coded log of every request through the tunnel

Request log colors:
- Methods: GET (blue), POST (purple), PUT/PATCH (yellow), DELETE (red)
- Status: 2xx (green), 3xx (cyan), 4xx (yellow), 5xx (red)
- Duration: <100ms (green), 100-500ms (yellow), >500ms (red)

## Project Structure

```
pgrok/
├── setup.sh                  # Interactive installer (server + client)
├── server/
│   ├── Dockerfile            # Stock Caddy image
│   ├── docker-compose.yml    # Caddy container config
│   ├── Caddyfile             # On-demand TLS with LE + ZeroSSL fallback
│   ├── pgrok-tunnel          # Server-side tunnel controller (Python)
│   ├── pgrok-ask             # Cert validation endpoint (Python)
│   ├── pgrok-ask.service     # Systemd unit for pgrok-ask
│   └── setup-vps.sh          # Standalone server setup alternative
├── client/
│   ├── tui/                  # TUI client (TypeScript + OpenTUI)
│   │   ├── index.ts          # Entry point
│   │   ├── package.json
│   │   └── src/
│   │       ├── app.ts        # OpenTUI renderer + layout
│   │       ├── config.ts     # Config loader (~/.pgrok/config)
│   │       ├── tunnel.ts     # SSH subprocess + message parser
│   │       ├── proxy.ts      # Local reverse proxy for request logging
│   │       ├── stats.ts      # Connection statistics tracker
│   │       └── ui/           # UI panels (header, session, connections, requests)
│   └── config.example        # Client config template
└── README.md
```

## Prerequisites

**VPS:**
- Docker + Docker Compose
- Python 3
- SSH access (root for setup)
- Ports 80 and 443 open

**Mac:**
- [Bun](https://bun.sh) runtime (auto-installed by setup.sh if missing)
- SSH key pair (`ssh-keygen` if you don't have one)

**DNS:**
- A wildcard A record `*.yourdomain.com` pointing to your VPS

## How SSL Works

1. A request arrives for `myapp.yourdomain.com`
2. Caddy checks with `pgrok-ask` service: "Should I get a cert for this domain?"
3. `pgrok-ask` verifies it's a single-level subdomain of `*.yourdomain.com` (blocks `a.b.c.yourdomain.com` to prevent abuse)
4. Caddy uses HTTP-01 challenge to get a cert -- tries Let's Encrypt first, falls back to ZeroSSL if rate-limited
5. Cert is cached and auto-renewed
6. The TUI client triggers cert provisioning during tunnel setup, so it's ready before you open the URL

## Security

- SSH key authentication only (no passwords)
- Dedicated `pgrok` user with restricted SSH (remote forwarding only)
- Caddy admin API only on localhost (not exposed externally)
- SSH tunnels bind to localhost only (`GatewayPorts no`)
- `pgrok-ask` prevents cert abuse -- only allows single-level subdomains of `*.yourdomain.com`

## Configuration

### Client (`~/.pgrok/config`)

Generated by `setup.sh client`. You can edit manually:

```bash
PGROK_HOST=your-vps-ip
PGROK_DOMAIN=yourdomain.com
PGROK_USER=pgrok
PGROK_SSH_KEY=~/.ssh/id_ed25519
```

### Server

Files live in `/opt/pgrok/` after setup:

| File | Purpose |
|------|---------|
| `Caddyfile` | On-demand TLS config with LE + ZeroSSL |
| `docker-compose.yml` | Caddy container |
| `Dockerfile` | Stock Caddy image |

Scripts at `/usr/local/bin/`:

| Script | Purpose |
|--------|---------|
| `pgrok-tunnel` | Manages Caddy routes + provisions TLS certs (invoked by SSH) |
| `pgrok-ask` | Validates cert requests, blocks multi-level subdomains (systemd service) |

## Troubleshooting

**"SSH connection failed" during client setup:**
- Verify the server setup completed successfully
- Check that your SSH public key matches what was provided during server setup
- Try manually: `ssh pgrok@your-vps-ip`

**Stuck on "connecting" in the TUI:**
- Run with `--print-logs` flag, press Ctrl+C, then check `/tmp/pgrok-debug.log`
- Verify SSH can reach the server: `ssh pgrok@your-vps-ip echo ok`

**Stuck on "provisioning TLS...":**
- Let's Encrypt may be rate-limited (50 certs/week per domain). ZeroSSL fallback should handle this automatically.
- Check Caddy logs: `docker compose logs caddy` in `/opt/pgrok`
- Try a subdomain that already has a cert

**SSL certificate errors:**
- Verify the `pgrok-ask` service is running: `systemctl status pgrok-ask`
- Make sure ports 80 and 443 are open on the VPS firewall
- Check that Cloudflare proxy (orange cloud) is OFF for the wildcard DNS record

**"Port not yet reachable" warning:**
- Usually harmless -- SSH tunnel takes a moment to establish
- If traffic doesn't work, check your local service is running on the specified port

## Development

```bash
# Run in dev mode (no build step)
cd client/tui
bun install
bun run index.ts myapp 4000

# Build standalone binary
bun run build

# Type-check
bun run tsc --noEmit
```

## Limitations

- Single user (personal tool, not multi-tenant)
- No automatic reconnection (restart `pgrok` if connection drops)
- Stale routes possible on abrupt disconnection (self-heal on next connect to same subdomain)
- HTTP request logging only (WebSocket passthrough works but isn't logged)

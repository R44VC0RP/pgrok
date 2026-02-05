# pgrok — Agent Knowledge Base

## Architecture

- **Caddy was chosen over Traefik** because Traefik's Docker-label routing doesn't help here — tunnels route to SSH ports on localhost, not to containers. Caddy's admin API (`localhost:2019`) allows adding/removing reverse proxy routes at runtime via simple JSON POST/DELETE, which is the core mechanism for dynamic tunneling.
- **frp was evaluated and rejected.** frp and Traefik/Caddy both want ports 80/443, creating a conflict. For a single-user tool, SSH reverse tunnels are simpler and require zero extra software on the server. frp would only make sense for multi-user or non-SSH scenarios.
- The tunnel flow is: client SSH → server `pgrok-tunnel` script → Caddy admin API (add route) → stdin blocks → SSH drops → atexit removes route. The Python script's `sys.stdin.read()` is the mechanism that detects SSH disconnect.

## Server (Caddy + Docker)

- **`network_mode: host` is required** in `docker-compose.yml`. SSH tunnels bind to the host's `localhost`, which is unreachable from inside Docker's default bridge network. Without this, Caddy can see the route but can't reach the upstream.
- **Caddy needs a custom build** for Cloudflare DNS support. The `Dockerfile` uses `xcaddy build --with github.com/caddy-dns/cloudflare` in a multi-stage build. The module isn't included in the official Caddy image.
- **`caddy-dns/vercel` is broken and abandoned** (1 commit from 2021, never updated for `libdns` breaking API change). Do NOT use it. The `caddy-dns/cloudflare` module is actively maintained and is the correct choice. Env var: `CLOUDFLARE_API_TOKEN`.
- **On-Demand TLS is the preferred approach** — uses stock Caddy (no custom build), provisions individual certs via HTTP-01 challenge as requests arrive. Requires a `pgrok-ask` endpoint to prevent cert abuse. No DNS provider module or API token needed.
- **Cloudflare proxy (orange cloud) must be OFF** for the wildcard A record. Caddy handles TLS termination directly — if Cloudflare proxies, it breaks the SSL handshake since Caddy expects to terminate TLS itself.
- The Caddy admin API endpoint for adding routes is `POST /config/apps/http/servers/srv0/routes`. The `srv0` server name is Caddy's default when configured via Caddyfile. Deleting by ID uses `DELETE /id/<route-id>`.

## Server Script (`server/pgrok-tunnel`)

- Domain is configured two ways: `setup.sh` does `sed` replacement of `yourdomain.com` at install time, and the `PGROK_DOMAIN` env var serves as a runtime override. The sed approach means the installed copy at `/usr/local/bin/pgrok-tunnel` has the real domain baked in.
- The `read_timeout: 0` in the Caddy route config is intentional — it disables timeouts for long-lived connections like WebSockets and SSE streams.
- Stale route cleanup is a known gap. If SSH is SIGKILL'd, `atexit` won't fire and the Caddy route persists. Re-connecting with the same subdomain overwrites the stale route (same `@id`), which is a self-healing behavior.

## Server Script (`server/pgrok-ask`)

- A tiny HTTP server on port 9123 that Caddy's `on_demand_tls` directive queries before issuing a certificate. Returns 200 for `*.yourdomain.com`, 403 for anything else.
- Runs as a systemd service (`pgrok-ask.service`). Must be running before Caddy attempts to provision any certs.
- Without this, anyone could point a domain at the VPS and Caddy would issue certs for it, exhausting Let's Encrypt rate limits.

## Client (`client/pgrok`)

- Remote port is deterministic: `10000 + (cksum of subdomain) % 50000`. This means the same subdomain always gets the same remote port, avoiding the need for port negotiation. Collision is theoretically possible but negligible for single-user.
- The client uses `ssh -tt` (force pseudo-terminal allocation) so that the server-side `pgrok-tunnel` script receives a proper stdin that closes when the SSH connection drops.

## Setup Script (`setup.sh`)

- `setup.sh server` must run as root — it creates a system user, modifies `/etc/ssh/sshd_config`, installs to `/usr/local/bin`, and copies files to `/opt/pgrok`.
- `setup.sh client` uses `sudo` only for the `/usr/local/bin/pgrok` copy and checks write permission first to avoid unnecessary sudo prompts.
- The sshd config uses a marker comment (`# pgrok tunnel configuration`) to detect if it's already been applied, making the script idempotent.

## DNS

- A single wildcard A record (`*.yourdomain.com → VPS_IP`) is all that's needed. No per-tunnel DNS API calls. Explicit DNS records for specific subdomains take precedence over the wildcard per standard DNS specificity rules.
- The Cloudflare API token is only used for ACME DNS-01 challenges (creating/deleting `_acme-challenge` TXT records). It is NOT used at runtime for traffic routing.
- With On-Demand TLS, no API token is needed at all — Caddy uses HTTP-01 challenges which only require ports 80/443 open.

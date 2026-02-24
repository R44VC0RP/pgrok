#!/usr/bin/env bun
/**
 * pgrok — Expose local ports to the internet via SSH tunnels.
 *
 * Usage: pgrok <subdomain> <local-port>
 */

import { writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { loadConfig } from "./src/config"
import {
  spawnTunnel,
  parseTunnelMessage,
  initialTunnelState,
  type TunnelState,
} from "./src/tunnel"
import { startProxy, findProxyPort } from "./src/proxy"
import { StatsTracker } from "./src/stats"
import { createApp } from "./src/app"

const LOG_FILE = join(tmpdir(), "pgrok-debug.log")

const VERSION = "0.1.0"

// --- Arg parsing ---

const args = process.argv.slice(2)
const printLogs = args.includes("--print-logs") || args.includes("--debug")
const positionalArgs = args.filter((a) => !a.startsWith("--"))

if (args.includes("--version") || args.includes("-v")) {
  console.log(`pgrok v${VERSION}`)
  process.exit(0)
}

if (args.includes("--help") || args.includes("-h") || positionalArgs.length < 2) {
  console.log(`pgrok v${VERSION} — Expose local ports to the internet

Usage:
  pgrok <subdomain> <local-port> [options]

Options:
  --print-logs    Print raw tunnel logs on exit (for debugging)
  --debug         Alias for --print-logs
  --version, -v   Show version
  --help, -h      Show this help

Examples:
  pgrok myapp 4000        https://myapp.yourdomain.com -> localhost:4000
  pgrok api 3000          https://api.yourdomain.com -> localhost:3000

Configuration:
  Create ~/.pgrok/config with:
    PGROK_HOST=your-vps-ip-or-hostname
    PGROK_DOMAIN=yourdomain.com
    PGROK_USER=pgrok
    PGROK_SSH_KEY=~/.ssh/id_ed25519`)
  process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1)
}

const subdomain = positionalArgs[0].toLowerCase()
const localPort = parseInt(positionalArgs[1], 10)

// Validate subdomain
if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
  console.error(
    `Error: Invalid subdomain '${subdomain}'. Must be lowercase alphanumeric and hyphens, 1-63 characters.`
  )
  process.exit(1)
}

// Validate port
if (isNaN(localPort) || localPort < 1 || localPort > 65535) {
  console.error(`Error: Invalid port '${args[1]}'. Must be 1-65535.`)
  process.exit(1)
}

// --- Load config ---

let config
try {
  config = loadConfig()
} catch (err: any) {
  console.error(`Error: ${err.message}`)
  process.exit(1)
}

// --- Start TUI ---

const app = await createApp()
const { renderer, session, connections, requests } = app

// --- State ---

let tunnelState: TunnelState = initialTunnelState()
session.update(tunnelState, localPort)

const stats = new StatsTracker()
const logs: string[] = []

// --- Start local proxy ---

const proxyPort = findProxyPort(localPort + 10000)
const proxy = startProxy(proxyPort, localPort, (req) => {
  stats.recordRequest(req.durationMs)
  requests.addRequest(req)
  connections.update(stats.get())
})

// --- Spawn SSH tunnel (targets proxy, not user's service) ---

logs.push(`[init] config: host=${config.host} domain=${config.domain} user=${config.user} sshKey=${config.sshKey ?? "none"}`)
logs.push(`[init] subdomain=${subdomain} localPort=${localPort} proxyPort=${proxyPort}`)

const tunnel = spawnTunnel(config, subdomain, proxyPort)
logs.push(`[init] SSH process spawned, pid=${tunnel.process.pid}`)

tunnel.onLine((line) => {
  logs.push(`[tunnel] ${line}`)
  tunnelState = parseTunnelMessage(line, tunnelState)
  session.update(tunnelState, localPort)
})

// Handle tunnel exit
tunnel.process.exited.then((code) => {
  logs.push(`[tunnel] SSH process exited with code ${code}`)
  tunnelState = {
    ...tunnelState,
    status: "error",
    error: `SSH connection lost (exit code ${code})`,
  }
  session.update(tunnelState, localPort)
})

// --- Periodic stats refresh ---

const statsInterval = setInterval(() => {
  connections.update(stats.get())
}, 1000)

// --- Ctrl+C handler ---

renderer.keyInput.on("keypress", (key) => {
  if (key.ctrl && key.name === "c") {
    cleanup()
  }
})

function cleanup() {
  clearInterval(statsInterval)
  tunnel.kill()
  proxy.stop()
  app.destroy()

  if (printLogs) {
    const logLines = [
      "--- pgrok debug logs ---",
      `Timestamp: ${new Date().toISOString()}`,
      `Tunnel state: ${JSON.stringify(tunnelState, null, 2)}`,
      `Proxy port: ${proxyPort}`,
      `Total log lines: ${logs.length}`,
      "",
      ...(logs.length === 0
        ? ["(no output received from SSH tunnel)"]
        : logs),
      "--- end logs ---",
    ]
    const logContent = logLines.join("\n")

    // Write to file (always works regardless of terminal state)
    writeFileSync(LOG_FILE, logContent + "\n")

    // Also try stdout — write synchronously to beat process.exit
    process.stdout.write(logContent + "\n")
    console.error(`\nDebug logs written to: ${LOG_FILE}`)
  }

  process.exit(0)
}

// Also handle signals
process.on("SIGINT", cleanup)
if (process.platform !== "win32") {
  process.on("SIGTERM", cleanup)
}

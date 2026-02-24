/**
 * SSH tunnel manager — spawns the SSH process and parses server messages.
 */

import type { Subprocess } from "bun"
import type { PgrokConfig } from "./config"

// --- Tunnel state ---

export interface TunnelState {
  status: "connecting" | "provisioning_tls" | "online" | "error"
  url: string | null
  certStatus: "pending" | "ready" | "warning"
  error: string | null
}

export function initialTunnelState(): TunnelState {
  return {
    status: "connecting",
    url: null,
    certStatus: "pending",
    error: null,
  }
}

// --- Message parser ---

export function parseTunnelMessage(
  line: string,
  state: TunnelState
): TunnelState {
  if (line.startsWith("Provisioning TLS certificate")) {
    return { ...state, status: "provisioning_tls", certStatus: "pending" }
  }
  if (line === "TLS certificate ready.") {
    return { ...state, certStatus: "ready" }
  }
  if (line.startsWith("Warning: TLS certificate not yet ready")) {
    return { ...state, certStatus: "warning" }
  }
  if (line.startsWith("pgrok tunnel active:")) {
    const url = line.replace("pgrok tunnel active: ", "").trim()
    return { ...state, status: "online", url }
  }
  if (line.startsWith("Error:")) {
    return { ...state, status: "error", error: line }
  }
  return state
}

// --- POSIX CRC-32 cksum (pure TypeScript, matches Unix `cksum` command) ---

const CRC_TABLE = /* @__PURE__ */ (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let crc = i << 24
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1
    }
    table[i] = crc >>> 0
  }
  return table
})()

/**
 * POSIX cksum: CRC-32 with length appended, then complemented.
 * Produces identical output to `printf '%s' "str" | cksum`.
 */
export function posixCksum(input: string): number {
  const bytes = new TextEncoder().encode(input)
  let crc = 0

  // Process each byte
  for (const b of bytes) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0
  }

  // Append the byte count (as variable-length little-endian bytes per POSIX spec)
  let len = bytes.length
  while (len > 0) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ (len & 0xff)) & 0xff]) >>> 0
    len = Math.floor(len / 256)
  }

  return (~crc >>> 0)
}

// --- Port computation (must match bash client's cksum) ---

export function computeRemotePort(subdomain: string): number {
  const hash = posixCksum(subdomain)
  return 10000 + (hash % 50000)
}

// --- SSH tunnel process ---

export interface TunnelHandle {
  process: Subprocess
  onLine: (cb: (line: string) => void) => void
  kill: () => void
}

export function spawnTunnel(
  config: PgrokConfig,
  subdomain: string,
  targetPort: number
): TunnelHandle {
  const remotePort = computeRemotePort(subdomain)

  const sshArgs: string[] = [
    "ssh",
    "-T", // No PTY — we read stdout as a pipe, not a terminal
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "LogLevel=ERROR",
  ]

  if (config.sshKey) {
    sshArgs.push("-i", config.sshKey)
  }

  sshArgs.push(
    "-R",
    `${remotePort}:localhost:${targetPort}`,
    `${config.user}@${config.host}`,
    // PYTHONUNBUFFERED=1 forces Python to flush stdout immediately,
    // which is needed since we're reading stdout as a pipe (no PTY).
    `PYTHONUNBUFFERED=1 /usr/local/bin/pgrok-tunnel ${subdomain} ${remotePort}`
  )

  const callbacks: ((line: string) => void)[] = []

  const proc = Bun.spawn(sshArgs, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  })

  // Stream stdout line-by-line
  const readStream = async (
    stream: ReadableStream<Uint8Array>,
    handler: (line: string) => void
  ) => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // Split on newlines and carriage returns (SSH PTY sends \r\n)
        const lines = buffer.split(/\r?\n|\r/)
        buffer = lines.pop()!
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed) handler(trimmed)
        }
      }
      // Flush remaining
      if (buffer.trim()) handler(buffer.trim())
    } catch {
      // Stream closed
    }
  }

  readStream(proc.stdout as ReadableStream<Uint8Array>, (line) => {
    callbacks.forEach((cb) => cb(line))
  })

  // Also forward stderr as messages
  readStream(proc.stderr as ReadableStream<Uint8Array>, (line) => {
    callbacks.forEach((cb) => cb(line))
  })

  return {
    process: proc,
    onLine: (cb) => callbacks.push(cb),
    kill: () => {
      try {
        proc.kill()
      } catch {
        // Already dead
      }
    },
  }
}

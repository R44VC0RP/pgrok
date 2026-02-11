/**
 * Local reverse proxy — sits between the SSH tunnel and the user's service.
 * Captures HTTP request metadata for the TUI request log.
 *
 * Matches ngrok behavior:
 * - Forwards all HTTP methods, headers, and bodies
 * - Adds standard proxy headers (X-Forwarded-For, X-Forwarded-Proto, etc.)
 * - Rewrites Host header to localhost:<port> for local service compatibility
 * - Strips hop-by-hop headers per HTTP spec
 * - Streams response bodies (SSE, chunked transfers)
 * - Proxies WebSocket connections bidirectionally with header/subprotocol forwarding
 * - Queues WS messages until upstream is open (prevents dropped frames)
 * - Strips Content-Encoding since Bun auto-decompresses
 * - Returns 502 gracefully when local service is down
 */

export interface HttpRequest {
  timestamp: Date
  method: string
  path: string
  statusCode: number
  statusText: string
  durationMs: number
}

export interface ProxyHandle {
  port: number
  stop: () => void
}

// Hop-by-hop headers that must NOT be forwarded through a proxy (RFC 2616 §13.5.1)
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

/** Strip hop-by-hop headers from a Headers object. */
function stripHopByHop(headers: Headers): void {
  // Also strip headers listed in the Connection header itself
  const connectionHeader = headers.get("connection")
  if (connectionHeader) {
    for (const name of connectionHeader.split(",")) {
      headers.delete(name.trim())
    }
  }
  for (const name of HOP_BY_HOP_HEADERS) {
    headers.delete(name)
  }
}

interface WsData {
  path: string
  search: string
  headers: Record<string, string>
  protocols: string[]
}

interface UpstreamWsState {
  ws: WebSocket
  ready: boolean
  queue: (string | ArrayBuffer | Uint8Array)[]
}

export function startProxy(
  listenPort: number,
  targetPort: number,
  onRequest: (req: HttpRequest) => void
): ProxyHandle {
  // Track upstream WebSocket connections
  const upstreamState = new Map<object, UpstreamWsState>()

  const server = Bun.serve({
    port: listenPort,
    maxRequestBodySize: 1024 * 1024 * 100, // 100MB

    async fetch(req, server) {
      const url = new URL(req.url)
      const originalHost = req.headers.get("host") || ""

      // --- WebSocket upgrade ---
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        // Collect headers to forward to upstream WebSocket
        // Keep cookies, auth, origin, and other app-level headers
        const fwdHeaders: Record<string, string> = {}
        const wsSpecHeaders = new Set([
          "upgrade",
          "connection",
          "sec-websocket-key",
          "sec-websocket-version",
          "sec-websocket-extensions",
          "sec-websocket-accept",
        ])

        req.headers.forEach((value, key) => {
          if (!wsSpecHeaders.has(key.toLowerCase())) {
            fwdHeaders[key] = value
          }
        })

        // Rewrite host for upstream
        fwdHeaders["host"] = `localhost:${targetPort}`

        // Extract subprotocols for forwarding
        const protocolHeader = req.headers.get("sec-websocket-protocol")
        const protocols = protocolHeader
          ? protocolHeader.split(",").map((p) => p.trim())
          : []

        const success = (server as any).upgrade(req, {
          data: {
            path: url.pathname,
            search: url.search,
            headers: fwdHeaders,
            protocols,
          } satisfies WsData,
        })
        if (success) return undefined as unknown as Response
        return new Response("WebSocket upgrade failed", { status: 400 })
      }

      // --- Regular HTTP ---
      const start = performance.now()
      const targetUrl = `http://localhost:${targetPort}${url.pathname}${url.search}`

      try {
        // Build forwarded headers
        const fwdHeaders = new Headers(req.headers)

        // Strip hop-by-hop headers before forwarding
        stripHopByHop(fwdHeaders)

        // Rewrite Host to localhost so the local service recognizes the request.
        fwdHeaders.set("host", `localhost:${targetPort}`)

        // Standard proxy headers (what ngrok sends)
        // Append to X-Forwarded-For chain instead of overwriting
        const priorXff = req.headers.get("x-forwarded-for")
        const clientIp = req.headers.get("x-real-ip") || "127.0.0.1"
        fwdHeaders.set(
          "x-forwarded-for",
          priorXff ? `${priorXff}, ${clientIp}` : clientIp
        )

        // Preserve original proto if set, otherwise default to https (from Caddy)
        const priorProto = req.headers.get("x-forwarded-proto")
        fwdHeaders.set("x-forwarded-proto", priorProto || "https")

        fwdHeaders.set("x-forwarded-host", originalHost)
        fwdHeaders.set("x-forwarded-port", "443")

        // Don't send compressed-request signals to the upstream since Bun
        // will auto-decompress the response and we strip Content-Encoding.
        fwdHeaders.delete("accept-encoding")

        const resp = await fetch(targetUrl, {
          method: req.method,
          headers: fwdHeaders,
          body: req.body,
          redirect: "manual",
        })

        const durationMs = performance.now() - start

        onRequest({
          timestamp: new Date(),
          method: req.method,
          path: url.pathname,
          statusCode: resp.status,
          statusText: resp.statusText,
          durationMs,
        })

        // Build response headers
        const respHeaders = new Headers(resp.headers)

        // Strip hop-by-hop headers from response
        stripHopByHop(respHeaders)

        // Strip Content-Encoding — Bun's fetch() auto-decompresses gzip/br,
        // so the body is decoded but headers still say "gzip".
        respHeaders.delete("content-encoding")
        respHeaders.delete("content-length")

        return new Response(resp.body, {
          status: resp.status,
          statusText: resp.statusText,
          headers: respHeaders,
        })
      } catch {
        const durationMs = performance.now() - start

        onRequest({
          timestamp: new Date(),
          method: req.method,
          path: url.pathname,
          statusCode: 502,
          statusText: "Bad Gateway",
          durationMs,
        })

        return new Response("502 Bad Gateway — local service not running\n", {
          status: 502,
          headers: { "content-type": "text/plain" },
        })
      }
    },

    websocket: {
      maxPayloadLength: 64 * 1024 * 1024, // 64MB
      idleTimeout: 120, // 2 minutes

      open(ws) {
        const data = ws.data as unknown as WsData
        const upstreamUrl = `ws://localhost:${targetPort}${data.path}${data.search}`

        // Create upstream WebSocket with forwarded headers and subprotocols
        const upstream = new WebSocket(upstreamUrl, data.protocols.length > 0 ? data.protocols : undefined)
        upstream.binaryType = "arraybuffer"

        const state: UpstreamWsState = {
          ws: upstream,
          ready: false,
          queue: [],
        }

        upstream.addEventListener("open", () => {
          state.ready = true
          // Flush any messages that arrived before upstream was ready
          for (const msg of state.queue) {
            try {
              upstream.send(msg)
            } catch {
              // upstream closed during flush
              break
            }
          }
          state.queue.length = 0
        })

        upstream.addEventListener("message", (event) => {
          // Forward upstream -> downstream
          try {
            if (typeof event.data === "string") {
              ws.sendText(event.data)
            } else if (event.data instanceof ArrayBuffer) {
              ws.send(new Uint8Array(event.data))
            } else {
              ws.send(event.data as any)
            }
          } catch {
            // downstream closed
          }
        })

        upstream.addEventListener("close", (event) => {
          upstreamState.delete(ws)
          try {
            ws.close(event.code, event.reason)
          } catch {
            // already closed
          }
        })

        upstream.addEventListener("error", () => {
          // Clean up map on error to prevent memory leaks
          upstreamState.delete(ws)
          try {
            ws.close(1011, "upstream error")
          } catch {
            // already closed
          }
        })

        upstreamState.set(ws, state)
      },

      message(ws, message) {
        const state = upstreamState.get(ws)
        if (!state) return

        if (state.ready && state.ws.readyState === WebSocket.OPEN) {
          // Upstream is connected, send directly
          state.ws.send(message)
        } else {
          // Queue until upstream is ready
          state.queue.push(
            typeof message === "string"
              ? message
              : message instanceof ArrayBuffer
                ? message
                : new Uint8Array(message)
          )
        }
      },

      close(ws, code, reason) {
        const state = upstreamState.get(ws)
        if (state) {
          try {
            state.ws.close(code, reason)
          } catch {
            // already closed
          }
          upstreamState.delete(ws)
        }
      },
    },
  })

  return {
    port: server.port!,
    stop: () => server.stop(),
  }
}

/**
 * Find an available port for the proxy.
 */
export function findProxyPort(preferredPort: number): number {
  try {
    const server = Bun.serve({
      port: preferredPort,
      fetch() {
        return new Response("")
      },
    })
    server.stop()
    return preferredPort
  } catch {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("")
      },
    })
    const port = server.port!
    server.stop()
    return port
  }
}

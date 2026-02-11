/**
 * Local reverse proxy — sits between the SSH tunnel and the user's service.
 * Captures HTTP request metadata for the TUI request log.
 *
 * Matches ngrok behavior:
 * - Forwards all HTTP methods, headers, and bodies
 * - Adds standard proxy headers (X-Forwarded-For, X-Forwarded-Proto, etc.)
 * - Rewrites Host header to localhost:<port> for local service compatibility
 * - Streams response bodies (SSE, chunked transfers)
 * - Proxies WebSocket connections bidirectionally (HMR, socket.io, etc.)
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

export function startProxy(
  listenPort: number,
  targetPort: number,
  onRequest: (req: HttpRequest) => void
): ProxyHandle {
  interface WsData {
    path: string
    search: string
    headers: Record<string, string>
  }

  // Track upstream WebSocket connections
  const upstreamSockets = new Map<object, WebSocket>()

  const server = Bun.serve({
    port: listenPort,
    // Increase limits for large uploads/payloads
    maxRequestBodySize: 1024 * 1024 * 100, // 100MB

    async fetch(req, server) {
      const url = new URL(req.url)
      const originalHost = req.headers.get("host") || ""

      // --- WebSocket upgrade ---
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        // Collect headers to forward to upstream WebSocket
        const fwdHeaders: Record<string, string> = {}
        req.headers.forEach((value, key) => {
          const lower = key.toLowerCase()
          if (
            lower !== "upgrade" &&
            lower !== "connection" &&
            lower !== "sec-websocket-key" &&
            lower !== "sec-websocket-version" &&
            lower !== "sec-websocket-extensions"
          ) {
            fwdHeaders[key] = value
          }
        })

        const success = (server as any).upgrade(req, {
          data: {
            path: url.pathname,
            search: url.search,
            headers: fwdHeaders,
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

        // Rewrite Host to localhost so the local service recognizes the request.
        // The original host is preserved in X-Forwarded-Host.
        fwdHeaders.set("host", `localhost:${targetPort}`)

        // Standard proxy headers (what ngrok sends)
        fwdHeaders.set("x-forwarded-for", req.headers.get("x-real-ip") || "127.0.0.1")
        fwdHeaders.set("x-forwarded-proto", "https")
        fwdHeaders.set("x-forwarded-host", originalHost)

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

        // Strip Content-Encoding — Bun's fetch() auto-decompresses gzip/br,
        // so the body is decoded but headers still say "gzip".
        respHeaders.delete("content-encoding")
        respHeaders.delete("content-length")
        // Let Bun/HTTP handle transfer encoding for streamed responses
        respHeaders.delete("transfer-encoding")

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
      // Increase WebSocket limits for large payloads
      maxPayloadLength: 64 * 1024 * 1024, // 64MB
      idleTimeout: 120, // 2 minutes

      open(ws) {
        const { path, search } = ws.data as unknown as WsData
        const upstreamUrl = `ws://localhost:${targetPort}${path}${search}`

        const upstream = new WebSocket(upstreamUrl)
        upstream.binaryType = "arraybuffer"

        upstream.addEventListener("open", () => {
          // Connection established
        })

        upstream.addEventListener("message", (event) => {
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
          try {
            ws.close(event.code, event.reason)
          } catch {
            // already closed
          }
        })

        upstream.addEventListener("error", () => {
          try {
            ws.close(1011, "upstream error")
          } catch {
            // already closed
          }
        })

        upstreamSockets.set(ws, upstream)
      },

      message(ws, message) {
        const upstream = upstreamSockets.get(ws)
        if (upstream && upstream.readyState === WebSocket.OPEN) {
          upstream.send(message)
        }
      },

      close(ws, code, reason) {
        const upstream = upstreamSockets.get(ws)
        if (upstream) {
          try {
            upstream.close(code, reason)
          } catch {
            // already closed
          }
          upstreamSockets.delete(ws)
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

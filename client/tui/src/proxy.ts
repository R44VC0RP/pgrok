/**
 * Local reverse proxy — sits between the SSH tunnel and the user's service.
 * Captures HTTP request metadata for the TUI request log.
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
  const server = Bun.serve({
    port: listenPort,
    async fetch(req) {
      const start = performance.now()
      const url = new URL(req.url)
      const targetUrl = `http://localhost:${targetPort}${url.pathname}${url.search}`

      try {
        // Forward the request to the user's service
        const resp = await fetch(targetUrl, {
          method: req.method,
          headers: req.headers,
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

        // Strip Content-Encoding and Content-Length headers.
        // Bun's fetch() auto-decompresses gzip/br responses, so the body
        // is already decoded — but the original headers still say "gzip".
        // Forwarding those causes ERR_CONTENT_DECODING_FAILED in browsers.
        const headers = new Headers(resp.headers)
        headers.delete("content-encoding")
        headers.delete("content-length")

        return new Response(resp.body, {
          status: resp.status,
          statusText: resp.statusText,
          headers,
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

        return new Response("Bad Gateway — local service not running", {
          status: 502,
        })
      }
    },
  })

  return {
    port: server.port!,
    stop: () => server.stop(),
  }
}

/**
 * Find an available port for the proxy.
 * Tries listenPort first, then falls back to an ephemeral port.
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
    // Port in use, use 0 for ephemeral
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

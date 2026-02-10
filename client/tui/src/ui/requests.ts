/**
 * HTTP Requests panel — scrollable log of proxied requests.
 * Uses Renderable API directly so dynamic updates work.
 * Each log line uses styled text (t`` template) for per-segment coloring.
 */

import {
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  TextAttributes,
  t,
  fg,
  bold,
  dim,
  type CliRenderer,
} from "@opentui/core"
import type { HttpRequest } from "../proxy"

// --- Color schemes ---

const METHOD_COLORS: Record<string, string> = {
  GET: "#61AFEF",    // blue
  POST: "#C678DD",   // purple
  PUT: "#E5C07B",    // yellow
  PATCH: "#E5C07B",  // yellow
  DELETE: "#E06C75",  // red
  HEAD: "#56B6C2",   // cyan
  OPTIONS: "#56B6C2", // cyan
}

function statusColor(code: number): string {
  if (code < 300) return "#98C379"  // green
  if (code < 400) return "#56B6C2"  // cyan
  if (code < 500) return "#E5C07B"  // yellow
  return "#E06C75"                   // red
}

function durationColor(ms: number): string {
  if (ms < 100) return "#98C379"   // green — fast
  if (ms < 500) return "#E5C07B"   // yellow — moderate
  return "#E06C75"                  // red — slow
}

export interface RequestsPanel {
  container: BoxRenderable
  addRequest: (req: HttpRequest) => void
}

const MAX_REQUESTS = 500
let requestCounter = 0

export function createRequestsPanel(renderer: CliRenderer): RequestsPanel {
  const container = new BoxRenderable(renderer, {
    id: "req-panel",
    flexDirection: "column",
    width: "100%",
    flexGrow: 1,
    paddingLeft: 2,
  })

  container.add(
    new TextRenderable(renderer, {
      id: "req-title",
      content: "HTTP Requests",
      fg: "#FFFFFF",
      attributes: TextAttributes.BOLD,
      height: 1,
    })
  )

  container.add(
    new TextRenderable(renderer, {
      id: "req-separator",
      content: "\u2500".repeat(76),
      fg: "#444444",
      height: 1,
    })
  )

  const scrollBox = new ScrollBoxRenderable(renderer, {
    id: "req-scroll",
    width: "100%",
    flexGrow: 1,
    stickyScroll: true,
    stickyStart: "bottom",
    viewportCulling: true,
    contentOptions: {
      flexDirection: "column",
    },
  })
  container.add(scrollBox)

  function addRequest(req: HttpRequest) {
    requestCounter++

    // Timestamp
    const time = req.timestamp.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    const ms = req.timestamp.getMilliseconds().toString().padStart(3, "0")
    const timestamp = `${time}.${ms}`

    // Method
    const method = req.method.padEnd(7)
    const methodColor = METHOD_COLORS[req.method] ?? "#ABB2BF"

    // Path
    const path =
      req.path.length > 28 ? req.path.slice(0, 27) + "\u2026" : req.path.padEnd(28)

    // Status
    const statusStr = `${req.statusCode}`
    const statusTextStr = req.statusText
    const sColor = statusColor(req.statusCode)

    // Duration
    const durationMs = Math.round(req.durationMs)
    const durationStr = durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`
    const dColor = durationColor(durationMs)

    const line = new TextRenderable(renderer, {
      id: `req-${requestCounter}`,
      content: t`${dim(timestamp)}  ${bold(fg(methodColor)(method))} ${fg("#ABB2BF")(path)} ${bold(fg(sColor)(statusStr))} ${fg(sColor)(statusTextStr.padEnd(16))} ${fg(dColor)(durationStr)}`,
      height: 1,
    })

    scrollBox.content.add(line)

    // Trim old entries
    const children = scrollBox.content.getChildren()
    while (children.length > MAX_REQUESTS) {
      const first = children.shift()
      if (first && first.id) {
        scrollBox.content.remove(first.id)
      }
    }
  }

  return { container, addRequest }
}

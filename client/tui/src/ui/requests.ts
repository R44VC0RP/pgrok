/**
 * HTTP Requests panel — scrollable log of proxied requests.
 */

import {
  Box,
  Text,
  ScrollBox,
  TextAttributes,
  type BoxRenderable,
  type ScrollBoxRenderable,
} from "@opentui/core"
import type { HttpRequest } from "../proxy"

const STATUS_COLORS: Record<number, string> = {
  2: "#00FF00", // 2xx green
  3: "#00CCFF", // 3xx cyan
  4: "#FFAA00", // 4xx yellow
  5: "#FF4444", // 5xx red
}

export interface RequestsPanel {
  container: BoxRenderable
  addRequest: (req: HttpRequest) => void
}

const MAX_REQUESTS = 500

let requestCounter = 0

export function createRequestsPanel(): RequestsPanel {
  const scrollBox = ScrollBox({
    width: "100%",
    flexGrow: 1,
    stickyScroll: true,
    stickyStart: "bottom",
    viewportCulling: true,
    contentOptions: {
      flexDirection: "column",
    },
  })

  const container = Box(
    {
      flexDirection: "column",
      width: "100%",
      flexGrow: 1,
      paddingLeft: 2,
    },
    Text({
      content: "HTTP Requests",
      fg: "#FFFFFF",
      attributes: TextAttributes.BOLD,
      height: 1,
    }),
    Text({
      content:
        "\u2500".repeat(76),
      fg: "#444444",
      height: 1,
    }),
    scrollBox
  ) as unknown as BoxRenderable

  const scrollRef = scrollBox as unknown as ScrollBoxRenderable

  function addRequest(req: HttpRequest) {
    requestCounter++
    const time = req.timestamp.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })

    const ms = req.timestamp.getMilliseconds().toString().padStart(3, "0")
    const method = req.method.padEnd(7)
    const path = req.path.length > 24 ? req.path.slice(0, 24) : req.path.padEnd(24)
    const status = `${req.statusCode} ${req.statusText}`.padEnd(20)
    const duration = `${Math.round(req.durationMs)}ms`

    const color =
      STATUS_COLORS[Math.floor(req.statusCode / 100)] ?? "#FFFFFF"

    const line = Text({
      id: `req-${requestCounter}`,
      content: `${time}.${ms}  ${method} ${path} ${status} ${duration}`,
      fg: color,
      height: 1,
    })

    scrollRef.content.add(line)

    // Trim old entries
    const children = scrollRef.content.getChildren()
    while (children.length > MAX_REQUESTS) {
      const first = children.shift()
      if (first && first.id) {
        scrollRef.content.remove(first.id)
      }
    }
  }

  return { container, addRequest }
}

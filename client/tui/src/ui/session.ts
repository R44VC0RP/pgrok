/**
 * Session panel — key-value rows for status, version, forwarding, TLS.
 */

import {
  Box,
  Text,
  type BoxRenderable,
  type TextRenderable,
} from "@opentui/core"
import type { TunnelState } from "../tunnel"

const DIM = "#888888"
const GREEN = "#00FF00"
const YELLOW = "#FFAA00"
const RED = "#FF4444"

interface SessionRow {
  value: TextRenderable
}

export interface SessionPanel {
  container: BoxRenderable
  update: (state: TunnelState, localPort: number) => void
}

export function createSessionPanel(): SessionPanel {
  const rows: Record<string, SessionRow> = {}

  const statusValue = Text({ content: "connecting", fg: YELLOW })
  const versionValue = Text({ content: "0.1.0", fg: "#FFFFFF" })
  const forwardingValue = Text({ content: "", fg: "#FFFFFF" })
  const tlsValue = Text({ content: "pending", fg: DIM })

  rows.status = { value: statusValue as unknown as TextRenderable }
  rows.version = { value: versionValue as unknown as TextRenderable }
  rows.forwarding = { value: forwardingValue as unknown as TextRenderable }
  rows.tls = { value: tlsValue as unknown as TextRenderable }

  const container = Box(
    {
      flexDirection: "column",
      width: "100%",
      height: 6,
      paddingLeft: 2,
      paddingTop: 1,
      paddingBottom: 1,
    },
    // Status row
    Box(
      { flexDirection: "row", width: "100%", height: 1 },
      Text({ content: "Session Status".padEnd(26), fg: DIM }),
      statusValue
    ),
    // Version row
    Box(
      { flexDirection: "row", width: "100%", height: 1 },
      Text({ content: "Version".padEnd(26), fg: DIM }),
      versionValue
    ),
    // Forwarding row
    Box(
      { flexDirection: "row", width: "100%", height: 1 },
      Text({ content: "Forwarding".padEnd(26), fg: DIM }),
      forwardingValue
    ),
    // TLS row
    Box(
      { flexDirection: "row", width: "100%", height: 1 },
      Text({ content: "TLS Certificate".padEnd(26), fg: DIM }),
      tlsValue
    )
  ) as unknown as BoxRenderable

  function update(state: TunnelState, localPort: number) {
    // Status
    const statusText =
      state.status === "online"
        ? "online"
        : state.status === "provisioning_tls"
          ? "provisioning TLS..."
          : state.status === "error"
            ? "error"
            : "connecting"

    const statusColor =
      state.status === "online"
        ? GREEN
        : state.status === "error"
          ? RED
          : YELLOW

    rows.status.value.content = statusText
    rows.status.value.fg = statusColor

    // Forwarding
    if (state.url) {
      rows.forwarding.value.content = `${state.url} -> http://localhost:${localPort}`
    }

    // TLS
    const certText =
      state.certStatus === "ready"
        ? "ready (Let's Encrypt)"
        : state.certStatus === "warning"
          ? "pending (will provision on first request)"
          : "provisioning..."

    const certColor =
      state.certStatus === "ready"
        ? GREEN
        : state.certStatus === "warning"
          ? YELLOW
          : DIM

    rows.tls.value.content = certText
    rows.tls.value.fg = certColor
  }

  return { container, update }
}

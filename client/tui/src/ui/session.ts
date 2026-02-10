/**
 * Session panel — key-value rows for status, version, forwarding, TLS.
 * Uses Renderable API directly so property changes trigger re-renders.
 */

import {
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core"
import type { TunnelState } from "../tunnel"

const DIM = "#888888"
const GREEN = "#00FF00"
const YELLOW = "#FFAA00"
const RED = "#FF4444"

export interface SessionPanel {
  container: BoxRenderable
  update: (state: TunnelState, localPort: number) => void
}

export function createSessionPanel(renderer: CliRenderer): SessionPanel {
  const container = new BoxRenderable(renderer, {
    id: "session-panel",
    flexDirection: "column",
    width: "100%",
    height: 6,
    paddingLeft: 2,
    paddingTop: 1,
    paddingBottom: 1,
  })

  function makeRow(key: string, label: string) {
    const row = new BoxRenderable(renderer, {
      id: `session-${key}`,
      flexDirection: "row",
      width: "100%",
      height: 1,
    })
    const labelText = new TextRenderable(renderer, {
      id: `session-${key}-label`,
      content: label.padEnd(26),
      fg: DIM,
    })
    const valueText = new TextRenderable(renderer, {
      id: `session-${key}-value`,
      content: "",
      fg: "#FFFFFF",
    })
    row.add(labelText)
    row.add(valueText)
    container.add(row)
    return valueText
  }

  const statusValue = makeRow("status", "Session Status")
  const versionValue = makeRow("version", "Version")
  const forwardingValue = makeRow("forwarding", "Forwarding")
  const tlsValue = makeRow("tls", "TLS Certificate")

  statusValue.content = "connecting"
  statusValue.fg = YELLOW
  versionValue.content = "0.1.0"

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

    statusValue.content = statusText
    statusValue.fg = statusColor

    // Forwarding
    if (state.url) {
      forwardingValue.content = `${state.url} -> http://localhost:${localPort}`
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

    tlsValue.content = certText
    tlsValue.fg = certColor
  }

  return { container, update }
}

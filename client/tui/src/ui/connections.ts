/**
 * Connections panel — stats table showing ttl/opn/rt1/rt5/p50/p90.
 */

import {
  Box,
  Text,
  type BoxRenderable,
  type TextRenderable,
} from "@opentui/core"
import type { ConnectionStats } from "../stats"

export interface ConnectionsPanel {
  container: BoxRenderable
  update: (stats: ConnectionStats) => void
}

export function createConnectionsPanel(): ConnectionsPanel {
  const valueText = Text({
    content: "0       0       0.00    0.00    0.00    0.00",
    fg: "#FFFFFF",
  })

  const container = Box(
    {
      flexDirection: "column",
      width: "100%",
      paddingLeft: 2,
      paddingBottom: 1,
      height: 4,
    },
    // Header row
    Box(
      { flexDirection: "row", width: "100%", height: 1 },
      Text({ content: "Connections".padEnd(26), fg: "#888888" }),
      Text({
        content: "ttl     opn     rt1     rt5     p50     p90",
        fg: "#888888",
      })
    ),
    // Value row
    Box(
      { flexDirection: "row", width: "100%", height: 1 },
      Text({ content: "".padEnd(26), fg: "#888888" }),
      valueText
    )
  ) as unknown as BoxRenderable

  const valueRef = valueText as unknown as TextRenderable

  function update(stats: ConnectionStats) {
    const fmtI = (n: number, w: number) => String(n).padEnd(w)
    const fmtF = (n: number, w: number) => n.toFixed(2).padEnd(w)

    valueRef.content = [
      fmtI(stats.totalRequests, 8),
      fmtI(stats.openConnections, 8),
      fmtF(stats.rate1m, 8),
      fmtF(stats.rate5m, 8),
      fmtF(stats.p50Ms, 8),
      fmtF(stats.p90Ms, 8),
    ].join("")
  }

  return { container, update }
}

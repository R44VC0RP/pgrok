/**
 * Connections panel — stats table showing ttl/opn/rt1/rt5/p50/p90.
 * Uses Renderable API directly so property changes trigger re-renders.
 */

import {
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core"
import type { ConnectionStats } from "../stats"

export interface ConnectionsPanel {
  container: BoxRenderable
  update: (stats: ConnectionStats) => void
}

export function createConnectionsPanel(renderer: CliRenderer): ConnectionsPanel {
  const container = new BoxRenderable(renderer, {
    id: "conn-panel",
    flexDirection: "column",
    width: "100%",
    paddingLeft: 2,
    paddingBottom: 1,
    height: 4,
  })

  // Header row
  const headerRow = new BoxRenderable(renderer, {
    id: "conn-header",
    flexDirection: "row",
    width: "100%",
    height: 1,
  })
  headerRow.add(
    new TextRenderable(renderer, {
      id: "conn-header-label",
      content: "Connections".padEnd(26),
      fg: "#888888",
    })
  )
  headerRow.add(
    new TextRenderable(renderer, {
      id: "conn-header-cols",
      content: "ttl     opn     rt1     rt5     p50     p90",
      fg: "#888888",
    })
  )

  // Value row
  const valueRow = new BoxRenderable(renderer, {
    id: "conn-values",
    flexDirection: "row",
    width: "100%",
    height: 1,
  })
  valueRow.add(
    new TextRenderable(renderer, {
      id: "conn-values-pad",
      content: "".padEnd(26),
    })
  )
  const valueText = new TextRenderable(renderer, {
    id: "conn-values-text",
    content: "0       0       0.00    0.00    0.00    0.00",
    fg: "#FFFFFF",
  })
  valueRow.add(valueText)

  container.add(headerRow)
  container.add(valueRow)

  function update(stats: ConnectionStats) {
    const fmtI = (n: number, w: number) => String(n).padEnd(w)
    const fmtF = (n: number, w: number) => n.toFixed(2).padEnd(w)

    valueText.content = [
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

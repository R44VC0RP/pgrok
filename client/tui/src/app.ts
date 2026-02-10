/**
 * App root — creates the OpenTUI renderer and assembles all panels.
 */

import { createCliRenderer, type CliRenderer } from "@opentui/core"
import { createHeader } from "./ui/header"
import { createSessionPanel, type SessionPanel } from "./ui/session"
import {
  createConnectionsPanel,
  type ConnectionsPanel,
} from "./ui/connections"
import { createRequestsPanel, type RequestsPanel } from "./ui/requests"

export interface App {
  renderer: CliRenderer
  session: SessionPanel
  connections: ConnectionsPanel
  requests: RequestsPanel
  destroy: () => void
}

export async function createApp(): Promise<App> {
  const renderer = await createCliRenderer({
    useAlternateScreen: true,
    exitOnCtrlC: false, // We handle Ctrl+C ourselves for cleanup
    useMouse: false, // Not needed for this dashboard
  })

  // Create all panels using the Renderable API (not constructs)
  // so that property updates (.content, .fg) trigger re-renders.
  const header = createHeader(renderer)
  const session = createSessionPanel(renderer)
  const connections = createConnectionsPanel(renderer)
  const requests = createRequestsPanel(renderer)

  // Assemble layout: vertical stack
  renderer.root.add(header)
  renderer.root.add(session.container)
  renderer.root.add(connections.container)
  renderer.root.add(requests.container)

  // Start the render loop for continuous updates
  renderer.start()

  function destroy() {
    renderer.stop()
    renderer.destroy()
  }

  return {
    renderer,
    session,
    connections,
    requests,
    destroy,
  }
}

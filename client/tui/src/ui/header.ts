/**
 * Header bar — "pgrok" title + "(Ctrl+C to quit)" hint.
 */

import {
  BoxRenderable,
  TextRenderable,
  TextAttributes,
  type CliRenderer,
} from "@opentui/core"

export function createHeader(renderer: CliRenderer): BoxRenderable {
  const header = new BoxRenderable(renderer, {
    id: "header",
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    height: 2,
    paddingLeft: 2,
    paddingRight: 2,
  })

  header.add(
    new TextRenderable(renderer, {
      id: "header-title",
      content: "pgrok",
      fg: "#00FF00",
      attributes: TextAttributes.BOLD,
    })
  )

  header.add(
    new TextRenderable(renderer, {
      id: "header-hint",
      content: "(Ctrl+C to quit)",
      fg: "#666666",
    })
  )

  return header
}

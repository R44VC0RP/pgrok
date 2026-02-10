/**
 * Header bar — "pgrok" title + "(Ctrl+C to quit)" hint.
 */

import {
  Box,
  Text,
  type BoxRenderable,
  TextAttributes,
} from "@opentui/core"

export function createHeader(): BoxRenderable {
  const header = Box(
    {
      flexDirection: "row",
      justifyContent: "space-between",
      width: "100%",
      height: 2,
      paddingLeft: 2,
      paddingRight: 2,
    },
    Text({
      content: "pgrok",
      fg: "#00FF00",
      attributes: TextAttributes.BOLD,
    }),
    Text({
      content: "(Ctrl+C to quit)",
      fg: "#666666",
    })
  ) as unknown as BoxRenderable

  return header
}

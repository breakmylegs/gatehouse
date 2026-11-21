import { useState } from "react"

/**
 * D-088, adaptive explanation depth: how much of how a decision was reached each area shows (the approval card, the
 * policy tester), kept on this computer per area. Short says only what would change it; Normal adds the stages that
 * matched something; Full shows every stage. A floor decision is always shown in full, whatever the depth.
 */
export type Depth = "short" | "normal" | "full"
export const DEPTHS: Depth[] = ["short", "normal", "full"]
const KEY = "gatehouse.explainDepth"

function read(): Record<string, Depth> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, Depth] => DEPTHS.includes(e[1] as Depth)))
  } catch {
    return {}
  }
}

export const depthFor = (area: string): Depth => read()[area] ?? "normal"

export function setDepthFor(area: string, depth: Depth): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [area]: depth }))
  } catch {
    // storage full or off: the choice lasts until the page closes
  }
}

export function useDepth(area: string): [Depth, (d: Depth) => void] {
  const [depth, set] = useState<Depth>(() => depthFor(area))
  return [
    depth,
    (d) => {
      setDepthFor(area, d)
      set(d)
    },
  ]
}

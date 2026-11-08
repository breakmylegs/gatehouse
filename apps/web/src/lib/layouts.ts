import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { useStore } from "../store"

/**
 * Layout presets (backlog U8): four ways to arrange the workspace in one step, from the palette. They use only the
 * panes and the sidebar, which Codehouse already keeps, so a layout chosen is kept through restarts and updates.
 */
export type LayoutPreset = "one" | "two" | "four" | "focus"

export const LAYOUTS: Array<{ id: LayoutPreset; label: string; keywords: string }> = [
  { id: "one", label: "Layout: one session", keywords: "single pane workspace" },
  { id: "two", label: "Layout: two side by side", keywords: "split panes compare" },
  { id: "four", label: "Layout: four at once", keywords: "grid panes all" },
  { id: "focus", label: "Layout: focus on one session", keywords: "hide sidebar full" },
]

/** Asks the window to show or hide the sidebar (App keeps it). */
export const RAIL_EVENT = "codeh:rail"

/** The panes for a preset: the session you are on first, then the other open ones, newest first. */
export function panesFor(
  preset: LayoutPreset,
  sessions: SessionInfo[],
  current: string | undefined,
): string[] {
  const open = sessions
    .filter((s) => s.state !== "ended" && s.state !== "error")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((s) => s.id)
  const first = current && open.includes(current) ? current : open[0]
  if (!first) return []
  const rest = open.filter((id) => id !== first)
  const count = preset === "two" ? 2 : preset === "four" ? 4 : 1
  return [first, ...rest].slice(0, count)
}

export function applyLayout(preset: LayoutPreset): void {
  const st = useStore.getState()
  const current = st.selectedSession ?? st.panes[0]
  const panes = panesFor(preset, Object.values(st.sessions), current)
  if (panes.length) {
    useStore.setState({ panes, selectedSession: panes[0] })
    st.setRoute("workspace")
  }
  window.dispatchEvent(new CustomEvent(RAIL_EVENT, { detail: { hidden: preset === "focus" } }))
}

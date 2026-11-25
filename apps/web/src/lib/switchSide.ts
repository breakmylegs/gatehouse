import { lastOpenOf } from "./lastOpen"
import { setRailMode, type RailMode } from "./railMode"
import { useStore, type Route } from "../store"

/**
 * O54: switching the sidebar to a side (the Chat | Code switch, or the Ask about code section) reopens the session you
 * last had open there, in the panes it was in. Only when it has been deleted, or there is none, does the side open on
 * its own page: New question for Ask about code, the session list for Code. The same on the Mac and on Windows.
 */
export function switchSide(side: RailMode, fallback: Route = side === "chat" ? "chat" : "sessions"): void {
  setRailMode(side)
  const last = lastOpenOf(side, useStore.getState().sessions)
  if (!last) {
    useStore.getState().setRoute(fallback)
    return
  }
  useStore.setState({
    route: "workspace",
    selectedSession: last.selected,
    panes: last.panes,
    focusPane: Math.max(0, last.panes.indexOf(last.selected)),
  })
}

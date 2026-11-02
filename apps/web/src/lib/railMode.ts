import { useSyncExternalStore } from "react"

/** Which side of the app the sidebar shows: chats, or coding sessions (owner, 2 Nov). */
export type RailMode = "chat" | "code"

const KEY = "gatehouse.railMode"
const CHANGED = "codeh:rail-mode"

function read(): RailMode {
  try {
    return localStorage.getItem(KEY) === "chat" ? "chat" : "code"
  } catch {
    return "code"
  }
}

export function setRailMode(mode: RailMode): void {
  if (read() === mode) return
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    // storage blocked: the choice lasts until the window closes
  }
  window.dispatchEvent(new Event(CHANGED))
}

const subscribe = (f: () => void) => {
  window.addEventListener(CHANGED, f)
  return () => window.removeEventListener(CHANGED, f)
}
export const useRailMode = () => useSyncExternalStore(subscribe, read)

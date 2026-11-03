import { useSyncExternalStore } from "react"

/**
 * Screen reader mode (B40): the conversation as one plain list, every message in order, rather than the windowed list
 * that only draws what is on screen. A screen reader can then move through all of it, find text and jump by heading.
 * Off until you switch it on in Settings; kept on this computer.
 */
const KEY = "gatehouse.screenReader"
const CHANGED = "codeh:screen-reader"

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
}

export function setScreenReaderMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1")
    else localStorage.removeItem(KEY)
  } catch {
    // storage blocked: the choice lasts until the window closes
  }
  window.dispatchEvent(new Event(CHANGED))
}

const subscribe = (f: () => void) => {
  window.addEventListener(CHANGED, f)
  return () => window.removeEventListener(CHANGED, f)
}
export const useScreenReaderMode = () => useSyncExternalStore(subscribe, read)

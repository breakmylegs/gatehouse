import { useEffect, useState } from "react"
import { api } from "./api"
import { effective } from "./shortcuts"

/**
 * T-071: the keys in force, from your settings, for the window's key handlers and the shortcut sheet. Read once, and
 * again when Settings saves them (the codeh:shortcuts-changed event).
 */
let cached: ReturnType<typeof effective> | undefined
export const SHORTCUTS_CHANGED = "codeh:shortcuts-changed"

export function useShortcuts(): ReturnType<typeof effective> {
  const [state, setState] = useState(() => cached ?? effective(undefined))
  useEffect(() => {
    let live = true
    const load = () =>
      void api<{ running?: { shortcuts?: Record<string, unknown> } }>("GET", "/api/settings").then((r) => {
        if (!live || !r.ok || !r.data) return
        cached = effective(r.data.running?.shortcuts)
        setState(cached)
      })
    if (!cached) load()
    window.addEventListener(SHORTCUTS_CHANGED, load)
    return () => {
      live = false
      window.removeEventListener(SHORTCUTS_CHANGED, load)
    }
  }, [])
  return state
}

/** For tests: forget what was read. */
export const forgetShortcuts = () => {
  cached = undefined
}

import { useEffect } from "react"
import { useStore, type Route } from "../store"

/**
 * T-109 (t3code review, O31): back and forward through the pages you visited, as in a browser: Alt+Left and Alt+Right
 * (the mouse's back and forward buttons too). Kept while the window is open, at most 50 pages.
 */
const MAX = 50

export class NavHistory {
  #past: Route[] = []
  #future: Route[] = []
  #moving = false

  /** A page was opened; going somewhere new clears what was ahead. */
  visited(from: Route, to: Route): void {
    if (this.#moving || from === to) return
    this.#past = [...this.#past, from].slice(-MAX)
    this.#future = []
  }

  back(current: Route, go: (r: Route) => void): boolean {
    const r = this.#past.pop()
    if (!r) return false
    this.#future.push(current)
    this.#move(go, r)
    return true
  }

  forward(current: Route, go: (r: Route) => void): boolean {
    const r = this.#future.pop()
    if (!r) return false
    this.#past.push(current)
    this.#move(go, r)
    return true
  }

  #move(go: (r: Route) => void, r: Route): void {
    this.#moving = true
    try {
      go(r)
    } finally {
      this.#moving = false
    }
  }
}

export const navHistory = new NavHistory()

export function useNavHistory(): void {
  useEffect(() => {
    const stop = useStore.subscribe((s, prev) => {
      if (s.route !== prev.route) navHistory.visited(prev.route, s.route)
    })
    const go = (r: Route) => useStore.getState().setRoute(r)
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
      const t = e.target as HTMLElement | null
      // In a text box Alt and an arrow are the text's, not the page's.
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)) return
      const cur = useStore.getState().route
      if (e.key === "ArrowLeft" ? navHistory.back(cur, go) : navHistory.forward(cur, go)) e.preventDefault()
    }
    const onMouse = (e: MouseEvent) => {
      const cur = useStore.getState().route
      if (e.button === 3 && navHistory.back(cur, go)) e.preventDefault()
      if (e.button === 4 && navHistory.forward(cur, go)) e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("mouseup", onMouse)
    return () => {
      stop()
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("mouseup", onMouse)
    }
  }, [])
}

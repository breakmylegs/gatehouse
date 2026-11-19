import { useEffect } from "react"
import { useStore, type Route } from "../store"

/**
 * T-109 (t3code review, O31): back and forward through the pages you visited, as in a browser: Alt+Left and Alt+Right
 * (the mouse's back and forward buttons too, and T-111 a trackpad swipe). Kept while the window is open, at most 50 pages.
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

/**
 * T-111: a two-finger swipe on a trackpad goes back or forward, as in a browser. The swipe arrives as horizontal
 * wheel scrolling: once it adds up to SWIPE_PX within a short run, with little vertical movement, it counts once,
 * then rests. Over something that scrolls sideways itself (a wide table, code, the diff) it is that thing's.
 */
export const SWIPE_PX = 160
const GAP_MS = 300
const REST_MS = 700

export class SwipeDetector {
  #dx = 0
  #dy = 0
  #last = 0
  #restUntil = 0

  /** A wheel event: "back" or "forward" once a swipe adds up, else undefined. */
  wheel(e: { deltaX: number; deltaY: number; ctrlKey?: boolean }, now: number, scrollsSideways: boolean): "back" | "forward" | undefined {
    if (e.ctrlKey || scrollsSideways || now < this.#restUntil) return undefined
    if (now - this.#last > GAP_MS) this.#dx = this.#dy = 0
    this.#last = now
    this.#dx += e.deltaX
    this.#dy += Math.abs(e.deltaY)
    if (Math.abs(this.#dx) < SWIPE_PX || this.#dy > Math.abs(this.#dx) / 2) return undefined
    const way = this.#dx < 0 ? "back" : "forward"
    this.#dx = this.#dy = 0
    this.#restUntil = now + REST_MS
    return way
  }
}

/** Whether anything from the target up can still scroll sideways the way the swipe goes. */
export function scrollsSideways(target: EventTarget | null, deltaX: number): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
    const style = getComputedStyle(el)
    if (!/(auto|scroll)/.test(style.overflowX) || el.scrollWidth <= el.clientWidth) continue
    if (deltaX < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth) return true
  }
  return false
}

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
    const swipe = new SwipeDetector()
    const onWheel = (e: WheelEvent) => {
      const way = swipe.wheel(e, performance.now(), scrollsSideways(e.target, e.deltaX))
      if (!way) return
      const cur = useStore.getState().route
      if (way === "back") navHistory.back(cur, go)
      else navHistory.forward(cur, go)
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("mouseup", onMouse)
    window.addEventListener("wheel", onWheel, { passive: true })
    return () => {
      stop()
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("mouseup", onMouse)
      window.removeEventListener("wheel", onWheel)
    }
  }, [])
}

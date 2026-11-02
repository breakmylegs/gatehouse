import { useRef } from "react"

export const RAIL_WIDTH = "gatehouse.rail.width"
export const RAIL_MIN = 200
export const RAIL_MAX = 480
export const RAIL_START = 272

/** The sidebar's width as you left it, kept across restarts. */
export function savedRailWidth(): number {
  const n = Number(localStorage.getItem(RAIL_WIDTH))
  return Number.isFinite(n) && n >= RAIL_MIN && n <= RAIL_MAX ? n : RAIL_START
}

const clamp = (n: number) => Math.round(Math.min(RAIL_MAX, Math.max(RAIL_MIN, n)))

/**
 * The sidebar's edge, dragged to make it wider or narrower (owner, 31 Oct). The arrow keys move it too, and a double
 * click puts it back.
 */
export function RailResizer({ width, onChange }: { width: number; onChange: (w: number) => void }) {
  const from = useRef<{ x: number; w: number }>(undefined)
  const set = (w: number) => {
    const next = clamp(w)
    localStorage.setItem(RAIL_WIDTH, String(next))
    onChange(next)
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Sidebar width"
      aria-valuemin={RAIL_MIN}
      aria-valuemax={RAIL_MAX}
      aria-valuenow={width}
      tabIndex={0}
      className="rail-resizer"
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture?.(e.pointerId)
        from.current = { x: e.clientX, w: width }
      }}
      onPointerMove={(e) => {
        if (from.current) onChange(clamp(from.current.w + e.clientX - from.current.x))
      }}
      onPointerUp={(e) => {
        if (!from.current) return
        set(from.current.w + e.clientX - from.current.x)
        from.current = undefined
      }}
      onPointerCancel={() => {
        from.current = undefined
      }}
      onDoubleClick={() => set(RAIL_START)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16
        if (e.key === "ArrowLeft") set(width - step)
        else if (e.key === "ArrowRight") set(width + step)
        else if (e.key === "Home") set(RAIL_MIN)
        else if (e.key === "End") set(RAIL_MAX)
        else return
        e.preventDefault()
      }}
    />
  )
}

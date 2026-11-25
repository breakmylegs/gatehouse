import { useEffect, useRef } from "react"
import { rememberPage, sectionOf } from "../lib/sections"
import { useStore, type Route } from "../store"

/**
 * O48: the pages of the section you are in, as pill buttons along the top of the page, the current one marked. One tab
 * stop; the arrow keys, Home and End move between them, as a toolbar does.
 */
export function SectionPills({ route }: { route: Route }) {
  const setRoute = useStore((s) => s.setRoute)
  const section = sectionOf(route)
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => rememberPage(route), [route])
  if (!section || section.pages.length < 2) return null
  const at = section.pages.findIndex((p) => p.route === route)
  const go = (i: number, focus: boolean) => {
    const p = section.pages[(i + section.pages.length) % section.pages.length]!
    setRoute(p.route)
    if (focus) requestAnimationFrame(() => bar.current?.querySelector<HTMLButtonElement>(`[data-route="${p.route}"]`)?.focus())
  }
  return (
    <nav aria-label={`${section.label} pages`} className="section-pills">
      <div
        ref={bar}
        role="toolbar"
        aria-label={section.label}
        className="flex flex-wrap gap-1.5"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault()
            go(at + (e.key === "ArrowRight" ? 1 : -1), true)
          } else if (e.key === "Home" || e.key === "End") {
            e.preventDefault()
            go(e.key === "Home" ? 0 : section.pages.length - 1, true)
          }
        }}
      >
        {section.pages.map((p, i) => (
          <button
            key={p.route}
            type="button"
            data-route={p.route}
            className="section-pill"
            aria-current={p.route === route ? "page" : undefined}
            tabIndex={i === Math.max(0, at) ? 0 : -1}
            onClick={() => go(i, false)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </nav>
  )
}

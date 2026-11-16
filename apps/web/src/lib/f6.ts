import { useEffect } from "react"

/**
 * T-108 (t3code review, O31): F6 moves the keyboard to the next area of the window, Shift+F6 to the one before: the
 * command deck, the sidebar, the page, and the prompt box when there is one. Each area gets its first control.
 */
const AREAS = [
  'header[aria-label="Command deck"]',
  'nav[aria-label="Sidebar"]',
  "main",
  'textarea[aria-label="Prompt"]',
]

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/** The areas there are now, in order. */
export function areas(root: ParentNode = document): HTMLElement[] {
  return AREAS.flatMap((sel) => [...root.querySelectorAll<HTMLElement>(sel)].slice(0, 1))
}

/** Moves the keyboard to the next (or previous) area from where it is. */
export function cycle(back: boolean, root: Document = document): HTMLElement | undefined {
  const list = areas(root)
  if (!list.length) return undefined
  const active = root.activeElement
  // The innermost area holding the focus: the prompt box is inside the page, so it is checked first.
  const at = [...list.keys()].reverse().find((i) => list[i] === active || list[i]!.contains(active))
  const next = list[(((at ?? -1) + (back ? -1 : 1)) % list.length + list.length) % list.length]!
  const target = next.matches(FOCUSABLE) ? next : (next.querySelector<HTMLElement>(FOCUSABLE) ?? next)
  if (target === next && !next.hasAttribute("tabindex") && !next.matches(FOCUSABLE)) next.setAttribute("tabindex", "-1")
  target.focus()
  return target
}

export function useF6(): void {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "F6" || e.ctrlKey || e.altKey || e.metaKey) return
      e.preventDefault()
      cycle(e.shiftKey)
    }
    window.addEventListener("keydown", on)
    return () => window.removeEventListener("keydown", on)
  }, [])
}

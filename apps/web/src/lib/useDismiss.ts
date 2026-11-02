import { useEffect, type RefObject } from "react"

/**
 * Closes a small popover when you click or tap outside it, or press Esc (owner, 1 Nov: the plan limits stayed open
 * after clicking away). The element given holds the button and the popover, so the button still toggles it.
 */
export function useDismiss(
  open: boolean,
  close: () => void,
  root: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent | MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, close, root])
}

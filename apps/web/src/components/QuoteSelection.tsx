import { useEffect, useRef, useState } from "react"

/**
 * T-040 (t3code review, O31): select part of one of Claude's replies in this pane and a button offers to quote it into
 * the prompt box; Ctrl+Shift+Q does the same from the keyboard. Only a selection inside one reply, in this pane.
 */
export function QuoteSelection({
  pane,
  onQuote,
  disabled,
}: {
  /** The pane this prompt box belongs to; selections elsewhere are not this box's. */
  pane: () => Element | null
  onQuote: (text: string) => void
  disabled?: boolean
}) {
  const [at, setAt] = useState<{ text: string; x: number; y: number }>()
  const current = useRef(at)
  current.current = at

  useEffect(() => {
    const replyOf = (n: Node | null) => (n instanceof Element ? n : (n?.parentElement ?? null))?.closest(".reply") ?? null
    const read = () => {
      const s = document.getSelection()
      const root = pane()
      if (disabled || !s || s.isCollapsed || !root) return setAt(undefined)
      const a = replyOf(s.anchorNode)
      if (!a || a !== replyOf(s.focusNode) || !root.contains(a)) return setAt(undefined)
      const text = s.toString()
      if (!text.trim()) return setAt(undefined)
      let x = 0
      let y = 0
      try {
        const r = s.getRangeAt(0).getBoundingClientRect()
        x = r.left + r.width / 2
        y = r.top
      } catch {
        // no layout (a test): the button still works from the keyboard and by click
      }
      setAt({ text, x, y })
    }
    const key = (e: KeyboardEvent) => {
      const q = current.current
      if (!q || !e.ctrlKey || !e.shiftKey || e.key.toLowerCase() !== "q") return
      e.preventDefault()
      onQuote(q.text)
      document.getSelection()?.removeAllRanges()
      setAt(undefined)
    }
    document.addEventListener("selectionchange", read)
    window.addEventListener("keydown", key)
    return () => {
      document.removeEventListener("selectionchange", read)
      window.removeEventListener("keydown", key)
    }
  }, [pane, onQuote, disabled])

  if (!at) return null
  return (
    <button
      type="button"
      className="btn quote-selection !min-h-7 !px-2 !text-[12.5px]"
      style={{ position: "fixed", left: Math.max(8, at.x), top: Math.max(8, at.y - 36), transform: "translateX(-50%)", zIndex: 30 }}
      aria-keyshortcuts="Control+Shift+Q"
      // Keep the selection while the button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onQuote(at.text)
        document.getSelection()?.removeAllRanges()
        setAt(undefined)
      }}
    >
      Quote in prompt <kbd aria-hidden="true">Ctrl Shift Q</kbd>
    </button>
  )
}

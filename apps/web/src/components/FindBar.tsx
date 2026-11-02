import { useEffect, useRef } from "react"

/**
 * Find in this conversation (owner, 2 Nov: the everyday features of the Claude and ChatGPT apps): a small bar over the
 * transcript. Enter goes to the next match and Shift+Enter to the one before; Esc closes it.
 */
export function FindBar({
  query,
  count,
  at,
  onQuery,
  onStep,
  onClose,
}: {
  query: string
  count: number
  /** Which match is shown, from 0. */
  at: number
  onQuery: (q: string) => void
  onStep: (by: 1 | -1) => void
  onClose: () => void
}) {
  const box = useRef<HTMLInputElement>(null)
  useEffect(() => {
    box.current?.focus()
    box.current?.select()
  }, [])
  const said = !query.trim() ? "" : count ? `${at + 1} of ${count}` : "No matches"
  return (
    <div role="search" aria-label="Find in this conversation" className="find-bar panel">
      <input
        ref={box}
        className="field !min-h-7 w-56"
        aria-label="Find in this conversation"
        placeholder="Find in this conversation"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            onStep(e.shiftKey ? -1 : 1)
          } else if (e.key === "Escape") {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <span role="status" className="min-w-16 text-[12.5px] text-mut">
        {said}
      </span>
      <button
        type="button"
        className="btn !min-h-7 !px-2"
        aria-label="Previous match"
        disabled={!count}
        onClick={() => onStep(-1)}
      >
        <span aria-hidden="true">&#8593;</span>
      </button>
      <button
        type="button"
        className="btn !min-h-7 !px-2"
        aria-label="Next match"
        disabled={!count}
        onClick={() => onStep(1)}
      >
        <span aria-hidden="true">&#8595;</span>
      </button>
      <button
        type="button"
        className="btn !min-h-7 !px-2"
        aria-label="Close find"
        onClick={onClose}
      >
        <span aria-hidden="true">&times;</span>
      </button>
    </div>
  )
}

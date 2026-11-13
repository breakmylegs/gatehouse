import { useEffect, useRef, useState } from "react"
import { BINDINGS } from "../lib/commands"
import { isMac, keyLabel } from "../lib/platform-mac" // Mac fork

// Mac fork: Command-comma opens Settings, as in every Mac app (App.tsx).
const MAC_BINDINGS = isMac() ? [{ keys: "Ctrl ,", label: "Settings" }] : []

/**
 * Ctrl+/ lists every key Codehouse answers to, from the same list the palette shows its keys from (owner's plan, W1-05).
 * Esc or Close puts you back where you were.
 */
export function ShortcutSheet() {
  const [open, setOpen] = useState(false)
  const back = useRef<HTMLElement | null>(null)
  const close = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const show = () => {
      back.current = document.activeElement as HTMLElement | null
      setOpen(true)
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault()
        if (open) setOpen(false)
        else show()
      }
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("codeh:shortcuts", show)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("codeh:shortcuts", show)
    }
  }, [open])

  useEffect(() => {
    if (open) close.current?.focus()
  }, [open])

  if (!open) return null
  const done = () => {
    setOpen(false)
    back.current?.focus?.()
  }
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-start justify-center bg-black/30 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && done()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="panel grid w-[520px] max-w-[92vw] gap-3 p-4"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault()
            done()
          }
        }}
      >
        <h2 className="m-0 text-[17px]">Keyboard shortcuts</h2>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {[...BINDINGS, ...MAC_BINDINGS].map((b) => (
            <div key={b.keys} className="contents">
              <dt>
                <kbd>{keyLabel(b.keys)}</kbd>
              </dt>
              <dd className="m-0">{b.label}</dd>
            </div>
          ))}
        </dl>
        <div>
          <button ref={close} type="button" className="btn" onClick={done}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

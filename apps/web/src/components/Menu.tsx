import clsx from "clsx"
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

export type MenuItem =
  | {
      kind?: "item"
      label: string
      onSelect: () => void
      /** A short note on the right, such as a shortcut. */
      hint?: string
      danger?: boolean
      disabled?: boolean
      checked?: boolean
    }
  | { kind: "separator" }
  | { kind: "heading"; label: string }

const GAP = 4
const MEASURING: React.CSSProperties = { opacity: 0, pointerEvents: "none", left: 0, top: 0 }

/**
 * A button that opens a short list of actions. The list floats above the page, placed by its button, so a scrolling
 * list or a narrow rail never clips it. Opening puts focus on the first action; Up and Down move, Home and End
 * jump, Esc closes and gives focus back to the button, and Tab or a click anywhere else closes it.
 */
export function Menu({
  label,
  button,
  items,
  className,
  placement = "below",
  align = "start",
  tone = "surface",
}: {
  /** What the button is called for a screen reader, when its content is an icon or a name. */
  label: string
  button: React.ReactNode
  items: MenuItem[]
  className?: string
  placement?: "below" | "above" | "right"
  align?: "start" | "end"
  /** "shell" in the dark rail, "surface" on a page. */
  tone?: "surface" | "shell"
}) {
  const [open, setOpen] = useState(false)
  // Measured before it is shown. Transparent, not hidden: a hidden element cannot take focus, and focus goes to
  // the first action as it opens (30 Oct: in a real browser the menu opened without focus).
  const [at, setAt] = useState<React.CSSProperties>(MEASURING)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()

  const actions = () => [
    ...(list.current?.querySelectorAll<HTMLButtonElement>("[role^=menuitem]:not(:disabled)") ?? []),
  ]

  // Placed once it has a size: beside, above or below its button, kept inside the window.
  useLayoutEffect(() => {
    if (!open || !trigger.current || !list.current) return
    const b = trigger.current.getBoundingClientRect()
    const m = list.current.getBoundingClientRect()
    let left = placement === "right" ? b.right + GAP : align === "end" ? b.right - m.width : b.left
    let top =
      placement === "right"
        ? b.top
        : placement === "above"
          ? b.top - m.height - GAP
          : b.bottom + GAP
    left = Math.max(GAP, Math.min(left, window.innerWidth - m.width - GAP))
    top = Math.max(GAP, Math.min(top, window.innerHeight - m.height - GAP))
    setAt({ left, top })
  }, [open, placement, align])

  useEffect(() => {
    if (!open) return
    actions()[0]?.focus()
    const away = (e: MouseEvent) => {
      const t = e.target as Node
      if (!trigger.current?.contains(t) && !list.current?.contains(t)) setOpen(false)
    }
    const gone = () => setOpen(false)
    document.addEventListener("mousedown", away)
    window.addEventListener("resize", gone)
    return () => {
      document.removeEventListener("mousedown", away)
      window.removeEventListener("resize", gone)
    }
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    setAt(MEASURING)
    if (refocus) trigger.current?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const all = actions()
    const now = all.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      close(true)
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const step = e.key === "ArrowDown" ? 1 : -1
      all[(now + step + all.length) % all.length]?.focus()
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault()
      ;(e.key === "Home" ? all[0] : all.at(-1))?.focus()
    } else if (e.key === "Tab") close(false)
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        {button}
      </button>
      {open
        ? createPortal(
            <div
              ref={list}
              id={id}
              role="menu"
              aria-label={label}
              className={clsx("menu", tone === "shell" && "menu-shell")}
              style={at}
              onKeyDown={onKeyDown}
            >
              {items.map((it, i) =>
                it.kind === "separator" ? (
                  <hr key={i} className="menu-sep" />
                ) : it.kind === "heading" ? (
                  <div key={i} className="menu-heading" role="presentation">
                    {it.label}
                  </div>
                ) : (
                  <button
                    key={i}
                    type="button"
                    role={it.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                    aria-checked={it.checked}
                    disabled={it.disabled}
                    className={clsx("menu-item", it.danger && "menu-danger")}
                    onClick={() => {
                      close(true)
                      it.onSelect()
                    }}
                  >
                    <span>{it.label}</span>
                    {it.hint ? <span className="menu-hint">{it.hint}</span> : null}
                  </button>
                ),
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

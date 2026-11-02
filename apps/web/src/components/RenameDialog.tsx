import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"

/** Gives a session a title of your own. Enter saves, Esc cancels; an empty title goes back to the project name. */
export function RenameDialog({
  current,
  fallback,
  onSave,
  onClose,
}: {
  current: string | undefined
  /** What it is called with no title: the project. */
  fallback: string
  onSave: (title: string | null) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(current ?? "")
  const id = useId()
  const box = useRef<HTMLInputElement>(null)
  const back = useRef<HTMLElement | null>(null)
  useEffect(() => {
    back.current = document.activeElement as HTMLElement | null
    box.current?.select()
    return () => back.current?.focus?.()
  }, [])
  const save = () => {
    onSave(value.trim() ? value.trim() : null)
    onClose()
  }
  return createPortal(
    <div className="picture-viewer !cursor-default" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-h`}
        className="panel grid w-[min(440px,92vw)] gap-3 p-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault()
            onClose()
          }
        }}
      >
        <h2 id={`${id}-h`} className="m-0 text-[17px]">
          Rename
        </h2>
        <label className="grid gap-1">
          <span>Title</span>
          <input
            ref={box}
            className="field"
            maxLength={120}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                save()
              }
            }}
          />
          <span className="text-[12.5px] text-mut">Leave it empty to show {fallback} again.</span>
        </label>
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary" onClick={save}>
            Save
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

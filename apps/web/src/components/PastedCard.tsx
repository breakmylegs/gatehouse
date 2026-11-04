import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { pastePreview } from "../lib/paste"
import { Icon } from "./Icon"

/**
 * A large paste waiting to be sent, as a card above the prompt box (owner, 4 Nov): its first lines, PASTED, a pencil
 * to read or change it, and a cross to take it out.
 */
export function PastedCard({
  text,
  onChange,
  onRemove,
}: {
  text: string
  onChange: (text: string) => void
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const lines = text.split(/\r?\n/).length
  const what = `Pasted text, ${text.length.toLocaleString()} characters, ${lines.toLocaleString()} ${lines === 1 ? "line" : "lines"}`
  return (
    <span className="paste-card" title={what}>
      <span className="paste-card-text" aria-label={what} role="img">
        {pastePreview(text)}
      </span>
      <span className="paste-card-foot">
        <span className="paste-card-tag" aria-hidden="true">
          PASTED
        </span>
        <button
          type="button"
          className="paste-card-edit"
          aria-label="Read or change the pasted text"
          onClick={() => setEditing(true)}
        >
          <Icon name="rename" size={14} />
        </button>
      </span>
      <button
        type="button"
        className="pic-remove"
        aria-label="Remove the pasted text"
        onClick={onRemove}
      >
        <Icon name="close" size={12} />
      </button>
      {editing ? (
        <PasteEditor
          text={text}
          onSave={(t) => (t.trim() ? onChange(t) : onRemove())}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </span>
  )
}

function PasteEditor({
  text,
  onSave,
  onClose,
}: {
  text: string
  onSave: (text: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(text)
  const id = useId()
  const box = useRef<HTMLTextAreaElement>(null)
  const back = useRef<HTMLElement | null>(null)
  useEffect(() => {
    back.current = document.activeElement as HTMLElement | null
    box.current?.focus()
    return () => back.current?.focus?.()
  }, [])
  return createPortal(
    <div className="picture-viewer !cursor-default" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-h`}
        className="panel grid w-[min(760px,94vw)] gap-3 p-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault()
            onClose()
          }
        }}
      >
        <h2 id={`${id}-h`} className="m-0 text-[17px]">
          Pasted text
        </h2>
        <label className="grid gap-1">
          <span className="sr-only">The pasted text</span>
          <textarea
            ref={box}
            className="field mono h-[min(60vh,520px)] resize-y text-[12.5px]"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onSave(value)
              onClose()
            }}
          >
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

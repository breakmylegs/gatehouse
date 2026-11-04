import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"

/**
 * B25 (goal mode): the check a session carries on until it passes, such as "npm test". Extreme approval then carries on
 * after each turn until Claude has run that check and it passed, within the same turn and spending limits.
 */
export function GoalDialog({
  current,
  extreme,
  onSave,
  onClose,
}: {
  current: string | undefined
  extreme: boolean
  onSave: (check: string | null) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(current ?? "")
  const id = useId()
  const box = useRef<HTMLInputElement>(null)
  useEffect(() => box.current?.focus(), [])
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
        className="panel grid w-[min(480px,92vw)] gap-3 p-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <h2 id={`${id}-h`} className="m-0 text-[17px]">
          Set a goal
        </h2>
        <label className="grid gap-1">
          <span>Carry on until this check passes</span>
          <input
            ref={box}
            className="field mono"
            aria-describedby={`${id}-help`}
            maxLength={300}
            placeholder="npm test"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[\r\n]/g, " "))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                save()
              }
            }}
          />
        </label>
        <span id={`${id}-help`} className="text-[12.5px] text-mut">
          Claude runs it as its own command, which the rules decide like any other, and stops once
          it passes.{" "}
          {extreme
            ? "It carries on by itself until then, within your turn and spending limits."
            : "It is used while Extreme approval carries on by itself, so switch Extreme approval on for this session to use it."}{" "}
          Leave it empty for no goal.
        </span>
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

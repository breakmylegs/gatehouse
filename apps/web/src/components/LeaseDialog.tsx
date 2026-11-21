import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"

export interface Lease {
  paths: string[]
  commands: string[]
  from: "plan" | "you"
  at: string
}

const lines = (s: string) =>
  s
    .split(/[\n,]/)
    .map((l) => l.trim())
    .filter(Boolean)

/**
 * D-023, the scope lease: in Auto and Accept edits, the paths a session may write and the commands it may run by
 * itself; anything else is asked. An approved plan that names paths sets it; you can change or clear it here.
 */
export function LeaseDialog({
  current,
  onSave,
  onClose,
}: {
  current: Lease | undefined
  onSave: (lease: { paths: string[]; commands: string[] } | null) => void
  onClose: () => void
}) {
  const [paths, setPaths] = useState((current?.paths ?? []).join("\n"))
  const [commands, setCommands] = useState((current?.commands ?? []).join(", "))
  const id = useId()
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => box.current?.focus(), [])
  const save = () => {
    const ps = lines(paths)
    onSave(ps.length ? { paths: ps, commands: lines(commands) } : null)
    onClose()
  }
  return createPortal(
    <div className="picture-viewer !cursor-default" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-h`}
        className="panel grid w-[min(520px,92vw)] gap-3 p-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <h2 id={`${id}-h`} className="m-0 text-[17px]">
          Scope lease
        </h2>
        <span className="text-[12.5px] text-mut">
          In Auto and Accept edits, this session writes only these paths and runs only these commands by itself; anything
          else asks you, whatever the rules allow. Commands that only read (ls, cat, Get-Content and the like) are always
          within it.{current?.from === "plan" ? " The approved plan set this one." : ""} Leave the paths empty for no lease.
        </span>
        <label className="grid gap-1">
          <span>Paths, one a line, from the project&apos;s folder</span>
          <textarea ref={box} className="field mono" rows={4} placeholder="src/**" spellCheck={false} value={paths} onChange={(e) => setPaths(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span>Commands, by their first word</span>
          <input className="field mono" placeholder="npm, git" spellCheck={false} value={commands} onChange={(e) => setCommands(e.target.value)} />
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

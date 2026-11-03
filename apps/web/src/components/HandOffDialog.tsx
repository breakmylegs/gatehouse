import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"

/** Hand off a side task (B13): what to do, and whether to do it in a new worktree. */
export function HandOffDialog({
  from,
  worktreeFirst,
  onStart,
  onClose,
}: {
  from: string
  /** Whether In a new worktree starts ticked: when the session is already in one. */
  worktreeFirst: boolean
  onStart: (task: string, worktree: boolean) => void
  onClose: () => void
}) {
  const titleId = useId()
  const [task, setTask] = useState("")
  const [worktree, setWorktree] = useState(worktreeFirst)
  // Focus goes back where it was when the dialog closes, as for Rename.
  const back = useRef<HTMLElement | null>(null)
  useEffect(() => {
    back.current = document.activeElement as HTMLElement | null
    return () => back.current?.focus?.()
  }, [])
  return createPortal(
    <div className="picture-viewer !cursor-default" onMouseDown={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="panel grid w-[min(560px,92vw)] gap-3 p-4"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        onSubmit={(e) => {
          e.preventDefault()
          if (task.trim()) onStart(task.trim(), worktree)
        }}
      >
        <h2 id={titleId} className="m-0 text-[17px]">
          Hand off a side task
        </h2>
        <p className="m-0 text-[13.5px] text-mut">
          A new session does it beside {from}, with the same mode and settings.
        </p>
        <label className="grid gap-1">
          <span>What should it do?</span>
          <textarea
            className="field"
            rows={4}
            autoFocus
            value={task}
            onChange={(e) => setTask(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-[14px]">
          <input
            type="checkbox"
            checked={worktree}
            onChange={(e) => setWorktree(e.target.checked)}
          />
          In a new worktree, so it never touches this session&apos;s files (for a folder in a git
          repository)
        </label>
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={!task.trim()}>
            Start the side task
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

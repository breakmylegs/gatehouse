import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { api } from "../lib/api"

/**
 * Puts a session in a project, so the sidebar lists it under that project's name (owner, 2 Nov: projects as their own
 * group, with sessions you already have moved into them). Choose a project, name a new one, or take it out of one.
 */
export function ProjectDialog({
  current,
  onSave,
  onClose,
}: {
  current: string | undefined
  onSave: (project: string | null) => void
  onClose: () => void
}) {
  const id = useId()
  const [projects, setProjects] = useState<string[]>()
  const [chosen, setChosen] = useState<string>(current ?? "")
  const [fresh, setFresh] = useState("")
  const [error, setError] = useState<string>()
  const first = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLElement | null>(null)
  useEffect(() => {
    back.current = document.activeElement as HTMLElement | null
    void api<{ projects: Array<{ name: string }> }>("GET", "/api/projects").then((r) => {
      setProjects(r.ok && r.data ? r.data.projects.map((p) => p.name) : [])
      requestAnimationFrame(() => first.current?.querySelector("input")?.focus())
    })
    return () => back.current?.focus?.()
  }, [])

  async function save() {
    const name = fresh.trim()
    if (name) {
      // A new project is made as the Projects page makes one, so it is there for chats too.
      if (!projects?.includes(name)) {
        const r = await api("POST", "/api/projects", { name })
        if (!r.ok) {
          setError(r.error ?? "That project could not be made")
          return
        }
      }
      onSave(name)
    } else onSave(chosen || null)
    onClose()
  }

  const names = [...new Set([...(projects ?? []), ...(current ? [current] : [])])].sort((a, b) =>
    a.localeCompare(b),
  )
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
          Move to a project
        </h2>
        {!projects ? (
          <p className="m-0 text-mut">Reading your projects…</p>
        ) : (
          <div
            ref={first}
            role="radiogroup"
            aria-label="Project"
            className="grid max-h-[40vh] gap-1 overflow-y-auto"
          >
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`${id}-p`}
                checked={!chosen && !fresh.trim()}
                onChange={() => {
                  setChosen("")
                  setFresh("")
                }}
              />
              No project (listed by its folder)
            </label>
            {names.map((n) => (
              <label key={n} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`${id}-p`}
                  checked={chosen === n && !fresh.trim()}
                  onChange={() => {
                    setChosen(n)
                    setFresh("")
                  }}
                />
                {n}
              </label>
            ))}
          </div>
        )}
        <label className="grid gap-1">
          <span>Or a new project</span>
          <input
            className="field"
            maxLength={60}
            value={fresh}
            onChange={(e) => {
              setFresh(e.target.value)
              setError(undefined)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                void save()
              }
            }}
          />
        </label>
        {error ? (
          <p role="alert" className="m-0 text-sev">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            Move
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

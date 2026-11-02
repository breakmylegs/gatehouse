import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { fillPrompt, variablesOf, type SavedPrompt } from "../lib/prompts"
import type { SessionMeta } from "../lib/sessionMeta"
import { Icon } from "./Icon"

type Panel = "none" | "prompts" | "commands" | "connectors" | "plugins"

/**
 * The composer's plus menu: attach files or photos, mention a folder, use a saved prompt, and see the session's slash commands, skills,
 * connectors and plugins. Attached files are mentioned in the prompt with @ and their path in the session folder.
 */
export function PlusMenu({
  sessionId,
  meta,
  onInsert,
  onPictures,
  disabled,
}: {
  sessionId: string
  meta: SessionMeta | undefined
  onInsert: (text: string) => void
  /** Pictures among the files you add, shown as thumbnails rather than paths. */
  onPictures?: (rels: string[]) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<Panel>("none")
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  const close = () => {
    setOpen(false)
    setPanel("none")
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      // Every way of closing goes back to the top of the menu, so it opens there next time.
      if (root.current && !root.current.contains(e.target as Node)) close()
    }
    window.addEventListener("mousedown", onDown)
    return () => window.removeEventListener("mousedown", onDown)
  }, [open])

  const [prompts, setPrompts] = useState<SavedPrompt[] | undefined>()
  async function loadPrompts() {
    const r = await api<{ prompts: SavedPrompt[] }>("GET", "/api/prompts")
    setPrompts(r.ok && r.data ? r.data.prompts : [])
  }

  async function addFiles() {
    close()
    setBusy(true)
    const picked = await api<{ paths: string[] }>("POST", "/api/files/pick-files", {
      session: sessionId,
    })
    if (!picked.ok) {
      setBusy(false)
      toast.error(picked.error ?? "The file window could not open")
      return
    }
    const paths = picked.data?.paths ?? []
    if (paths.length === 0) {
      setBusy(false)
      return
    }
    const r = await api<{ files: Array<{ path: string; rel?: string; error?: string }> }>(
      "POST",
      "/api/files/attach",
      { session: sessionId, paths },
    )
    setBusy(false)
    if (!r.ok || !r.data) {
      toast.error(r.error ?? "The files were not attached")
      return
    }
    const ok = r.data.files.filter((f) => f.rel)
    const isPicture = (rel: string) => /\.(png|jpe?g|gif|webp)$/i.test(rel)
    const pictures = ok.map((f) => f.rel as string).filter((rel) => onPictures && isPicture(rel))
    const others = ok.map((f) => f.rel as string).filter((rel) => !pictures.includes(rel))
    if (pictures.length) onPictures?.(pictures)
    if (others.length) onInsert(others.map((rel) => `@${rel}`).join(" ") + " ")
    for (const f of r.data.files.filter((x) => x.error))
      toast.error(`${f.path.split(/[\\/]/).pop()}: ${f.error}`)
  }

  async function addFolder() {
    close()
    const r = await api<{ path: string | null }>("POST", "/api/pick-folder", {})
    if (r.ok && r.data?.path) onInsert(`@${r.data.path} `)
    else if (!r.ok) toast.error(r.error ?? "The folder window could not open")
  }

  const commands = meta ? [...new Set([...meta.slashCommands, ...meta.skills])].sort() : []

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className="btn !min-h-9 !w-9 justify-center !px-0 text-[18px]"
        aria-label="Add files, a folder, a saved prompt, or see commands"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled || busy}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name="new" />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Add to the prompt"
          onKeyDown={(e) => e.key === "Escape" && close()}
          className="panel absolute bottom-11 left-0 z-20 grid w-[300px] gap-0.5 p-1.5 shadow-[0_8px_24px_rgb(0_0_0/0.18)]"
        >
          {panel === "none" ? (
            <>
              <MenuItem
                label="Add files or photos"
                hint="From anywhere; copied into the folder"
                onClick={() => void addFiles()}
              />
              <MenuItem
                label="Add a folder"
                hint="Mention a folder by its path"
                onClick={() => void addFolder()}
              />
              <MenuItem
                label="Saved prompts"
                hint="Yours, with any blanks filled in"
                onClick={() => {
                  setPanel("prompts")
                  void loadPrompts()
                }}
                more
              />
              <MenuItem
                label="Slash commands and skills"
                hint={`${commands.length} available`}
                onClick={() => setPanel("commands")}
                more
              />
              <MenuItem
                label="Connectors"
                hint={`${meta?.connectors.length ?? 0} in this session`}
                onClick={() => setPanel("connectors")}
                more
              />
              <MenuItem
                label="Plugins"
                hint={`${meta?.plugins.length ?? 0} loaded`}
                onClick={() => setPanel("plugins")}
                more
              />
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn !min-h-7 w-fit gap-1.5 !px-2.5 !text-[13px]"
                onClick={() => setPanel("none")}
              >
                <span aria-hidden="true">&lsaquo;</span> Back
              </button>
              <div className="max-h-72 overflow-auto">
                {panel === "prompts" ? (
                  <SavedPromptsPanel
                    prompts={prompts}
                    onUse={(text) => {
                      onInsert(text)
                      close()
                    }}
                  />
                ) : panel === "commands" ? (
                  commands.length ? (
                    commands.map((c) => (
                      <MenuItem
                        key={c}
                        label={`/${c.replace(/^\//, "")}`}
                        mono
                        onClick={() => {
                          onInsert(`/${c.replace(/^\//, "")} `)
                          close()
                        }}
                      />
                    ))
                  ) : (
                    <Empty text="The session lists its commands once it has started a turn." />
                  )
                ) : panel === "connectors" ? (
                  meta?.connectors.length ? (
                    meta.connectors.map((c) => (
                      <p
                        key={c.name}
                        role="menuitem"
                        className="m-0 flex items-center gap-2 px-2 py-1 text-[13px]"
                      >
                        <span className="mono">{c.name}</span>
                        <span className="sign ml-auto text-[12px] text-mut">{c.status}</span>
                      </p>
                    ))
                  ) : (
                    <Empty text="No connectors in this session. The organisation's managed settings may block outside MCP servers." />
                  )
                ) : meta?.plugins.length ? (
                  meta.plugins.map((p) => (
                    <p
                      key={p.name}
                      role="menuitem"
                      className="m-0 flex items-center gap-2 px-2 py-1 text-[13px]"
                    >
                      <span className="mono">{p.name}</span>
                      {p.version ? (
                        <span className="sign ml-auto text-[12px] text-mut">{p.version}</span>
                      ) : null}
                    </p>
                  ))
                ) : (
                  <Empty text="No plugins loaded in this session." />
                )}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

function MenuItem({
  label,
  hint,
  onClick,
  more,
  mono,
}: {
  label: string
  hint?: string
  onClick: () => void
  more?: boolean
  mono?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex w-full items-center gap-2 rounded border-0 bg-transparent px-2 py-1.5 text-left text-[14px] hover:bg-s2"
      onClick={onClick}
    >
      <span className={mono ? "mono text-[13px]" : "sign font-medium"}>{label}</span>
      {hint ? <span className="ml-auto text-[12px] text-mut">{hint}</span> : null}
      {more ? (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="text-mut">
          <path d="M3 1.5 7 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      ) : null}
    </button>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="m-0 px-2 py-1.5 text-[13px] text-mut">{text}</p>
}

/** Your saved prompts in the + menu (W1-14): choose one, fill in its blanks, and it goes into the prompt box. */
function SavedPromptsPanel({
  prompts,
  onUse,
}: {
  prompts: SavedPrompt[] | undefined
  onUse: (text: string) => void
}) {
  const [chosen, setChosen] = useState<SavedPrompt>()
  const [values, setValues] = useState<Record<string, string>>({})
  if (prompts === undefined)
    return <p className="m-0 p-2 text-[13px] text-mut">Reading your prompts…</p>
  if (prompts.length === 0)
    return (
      <p className="m-0 p-2 text-[13px] text-mut">
        No saved prompts yet. Add them on the Prompts page; {"{{name}}"} in one is a blank you fill
        in when you use it.
      </p>
    )
  if (chosen) {
    const vars = variablesOf(chosen.text)
    return (
      <form
        className="grid gap-2 p-1"
        aria-label={`Fill in ${chosen.title}`}
        onSubmit={(e) => {
          e.preventDefault()
          onUse(fillPrompt(chosen.text, values))
        }}
      >
        <strong className="text-[13.5px]">{chosen.title}</strong>
        {vars.map((v, i) => (
          <label key={v} className="grid gap-0.5 text-[13px]">
            <span>{v}</span>
            <input
              className="field"
              autoFocus={i === 0}
              value={values[v] ?? ""}
              onChange={(e) => setValues((x) => ({ ...x, [v]: e.target.value }))}
            />
          </label>
        ))}
        <button type="submit" className="btn btn-primary w-fit">
          Put it in the prompt box
        </button>
      </form>
    )
  }
  return (
    <ul className="m-0 grid list-none gap-0.5 p-0" aria-label="Saved prompts">
      {prompts.map((p) => (
        <li key={p.id}>
          <MenuItem
            label={p.title}
            hint={
              variablesOf(p.text).length ? `Asks for ${variablesOf(p.text).join(", ")}` : undefined
            }
            onClick={() => (variablesOf(p.text).length ? setChosen(p) : onUse(p.text))}
          />
        </li>
      ))}
    </ul>
  )
}

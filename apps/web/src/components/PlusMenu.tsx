import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import type { SessionMeta } from "../lib/sessionMeta"

type Panel = "none" | "commands" | "connectors" | "plugins"

/**
 * The composer's plus menu: attach files or photos, mention a folder, and see the session's slash commands, skills,
 * connectors and plugins. Attached files are mentioned in the prompt with @ and their path in the session folder.
 */
export function PlusMenu({
  sessionId,
  meta,
  onInsert,
  disabled,
}: {
  sessionId: string
  meta: SessionMeta | undefined
  onInsert: (text: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<Panel>("none")
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener("mousedown", onDown)
    return () => window.removeEventListener("mousedown", onDown)
  }, [open])

  const close = () => {
    setOpen(false)
    setPanel("none")
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
    if (ok.length) onInsert(ok.map((f) => `@${f.rel}`).join(" ") + " ")
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
        aria-label="Add files, a folder, or see commands"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled || busy}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M7 1.5v11M1.5 7h11"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
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
                className="sign flex items-center gap-1 rounded border-0 bg-transparent px-2 py-1 text-left text-[13px] text-mut hover:bg-s2"
                onClick={() => setPanel("none")}
              >
                Back
              </button>
              <div className="max-h-72 overflow-auto">
                {panel === "commands" ? (
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

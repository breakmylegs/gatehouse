import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { useStore } from "../store"
import { EmptyState } from "../components/EmptyState"

interface Summary {
  name: string
  hasInstructions: boolean
  files: number
}
interface Project {
  name: string
  instructions: string
  files: Array<{ name: string; size: number }>
  /** The providers its chats may use (B17); every provider when absent. */
  providers?: Array<"claude" | "local">
}

const PROVIDERS = [
  { id: "claude", label: "Claude" },
  { id: "local", label: "Models on this computer, or your organisation's gateway" },
] as const

const MAX_INSTRUCTIONS = 8000

const size = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(0)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`

/** A file's bytes as base64, for the Host. Read in pieces so a large file does not overflow the call. */
async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let out = ""
  for (let i = 0; i < bytes.length; i += 0x8000)
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(out)
}

/**
 * Chat projects (owner's plan, W1-07): a name, instructions for every chat in it, and knowledge files Claude reads
 * when they are relevant. Plain files in Codehouse's data folder.
 */
export function Projects() {
  const [list, setList] = useState<Summary[]>()
  const [open, setOpen] = useState<string>()
  const [project, setProject] = useState<Project>()
  const [name, setName] = useState("")
  const [text, setText] = useState("")
  const [error, setError] = useState<string>()
  const [confirm, setConfirm] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const setRoute = useStore((s) => s.setRoute)

  const reload = useCallback(async () => {
    const r = await api<{ projects: Summary[] }>("GET", "/api/projects")
    if (!r.ok) return setError(r.error ?? "Projects could not be read")
    setList(r.data?.projects ?? [])
  }, [])
  useEffect(() => void reload(), [reload])

  const show = useCallback(async (n: string) => {
    setOpen(n)
    setConfirm(false)
    const r = await api<{ project: Project }>("GET", `/api/projects/${encodeURIComponent(n)}`)
    if (!r.ok || !r.data) return setError(r.error ?? "That project could not be read")
    setProject(r.data.project)
    setText(r.data.project.instructions)
  }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setError(undefined)
    const r = await api("POST", "/api/projects", { name })
    if (!r.ok) return setError(r.error ?? "The project was not made")
    const made = name.trim()
    setName("")
    await reload()
    await show(made)
  }

  /** The providers this project's chats may use; all of them is saved as none named, so a new one is allowed too. */
  async function saveProviders(list: Array<"claude" | "local">) {
    if (!open || !project || list.length === 0) return
    const every = PROVIDERS.every((p) => list.includes(p.id))
    const r = await api("PUT", `/api/projects/${encodeURIComponent(open)}/providers`, {
      providers: every ? null : list,
    })
    if (!r.ok) return toast.error(r.error ?? "That was not saved", { id: "project" })
    const { providers: _old, ...rest } = project
    setProject(every ? rest : { ...rest, providers: list })
    toast(every ? "Its chats may use any provider." : "Saved.", { id: "project" })
  }
  async function saveInstructions() {
    if (!open || !project || text === project.instructions) return
    const r = await api("PUT", `/api/projects/${encodeURIComponent(open)}/instructions`, { text })
    if (!r.ok) return toast.error(r.error ?? "The instructions were not saved", { id: "project" })
    setProject({ ...project, instructions: text })
    toast("Instructions saved", { id: "project" })
    void reload()
  }

  async function addFiles(files: FileList | null) {
    if (!open || !files) return
    for (const f of Array.from(files)) {
      const r = await api("POST", `/api/projects/${encodeURIComponent(open)}/files`, {
        name: f.name,
        base64: await base64Of(f),
      })
      if (!r.ok) toast.error(`${f.name}: ${r.error ?? "not added"}`, { id: `file-${f.name}` })
    }
    if (picker.current) picker.current.value = ""
    await show(open)
    void reload()
  }

  async function removeFile(file: string) {
    if (!open) return
    const r = await api(
      "DELETE",
      `/api/projects/${encodeURIComponent(open)}/files/${encodeURIComponent(file)}`,
    )
    if (!r.ok) return toast.error(r.error ?? "The file was not removed", { id: "project" })
    toast(`${file} removed. Chats in this project stop using it from their next message.`, {
      id: "project",
    })
    await show(open)
    void reload()
  }

  async function remove() {
    if (!open) return
    const r = await api("DELETE", `/api/projects/${encodeURIComponent(open)}`)
    if (!r.ok) return toast.error(r.error ?? "The project was not removed", { id: "project" })
    setOpen(undefined)
    setProject(undefined)
    setConfirm(false)
    void reload()
  }

  return (
    <div className="sheet mx-auto grid max-w-[1040px] gap-4 p-6" aria-label="Projects">
      <div>
        <h1 className="m-0">Projects</h1>
        <p className="m-0 mt-1 max-w-[66ch] text-mut">
          A project gathers what a set of chats should know: instructions you write once, and files
          Claude reads when they are relevant. Start a chat in a project from the new chat page.
        </p>
      </div>
      {error ? (
        <p role="alert" className="m-0 font-semibold text-sev">
          {error}
        </p>
      ) : null}
      <div className="grid items-start gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
        <div className="grid gap-3">
          <form onSubmit={create} className="grid gap-2" aria-label="New project">
            <label className="grid gap-1">
              <span>New project</span>
              <input
                className="field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <button className="btn btn-primary" disabled={!name.trim()}>
              Make the project
            </button>
          </form>
          <nav aria-label="Your projects" className="settings-nav grid gap-0.5">
            {list === undefined ? <p className="m-0 text-mut">Loading…</p> : null}
            {list?.length === 0 ? (
              <EmptyState picture="empty-projects">
                <p className="m-0 text-mut">No projects yet.</p>
              </EmptyState>
            ) : null}
            {list?.map((p) => (
              <button
                key={p.name}
                type="button"
                aria-current={open === p.name ? "page" : undefined}
                onClick={() => void show(p.name)}
              >
                <span className="truncate">{p.name}</span>
                <span className="text-xs text-mut">
                  {p.files} file{p.files === 1 ? "" : "s"}
                </span>
              </button>
            ))}
          </nav>
        </div>
        {project ? (
          <section aria-label={`Project ${project.name}`} className="grid gap-4">
            <h2 className="m-0">{project.name}</h2>
            <label className="grid gap-1">
              <span>Instructions for every chat in this project</span>
              <textarea
                className="field"
                rows={6}
                maxLength={MAX_INSTRUCTIONS}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onBlur={() => void saveInstructions()}
              />
              <span className="text-xs text-mut">
                Up to {MAX_INSTRUCTIONS} characters. Saved when you leave the box. {text.length} so
                far.
              </span>
            </label>
            <fieldset className="m-0 grid gap-1 border-0 p-0">
              <legend className="mb-1 p-0 font-semibold">Who this project's chats may use</legend>
              {PROVIDERS.map((p) => {
                const allowed = project.providers ?? PROVIDERS.map((x) => x.id)
                const on = allowed.includes(p.id)
                return (
                  <label key={p.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={on}
                      // At least one stays: a project with no provider could have no chats.
                      disabled={on && allowed.length === 1}
                      onChange={() =>
                        void saveProviders(
                          on ? allowed.filter((x) => x !== p.id) : [...allowed, p.id],
                        )
                      }
                    />
                    {p.label}
                  </label>
                )
              })}
              <span className="text-xs text-mut">
                A chat in this project can only start on these. Use it to keep a client's work on
                the provider whose terms allow it. What each provider keeps is in Settings, Other AI
                providers.
              </span>
            </fieldset>
            <div className="grid gap-2">
              <span className="font-semibold">Knowledge files</span>
              {project.files.length === 0 ? (
                <p className="m-0 text-mut">No files yet. Add notes, documents or data.</p>
              ) : (
                <ul className="m-0 grid list-none gap-1 p-0">
                  {project.files.map((f) => (
                    <li key={f.name} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate">
                        {f.name} <span className="text-xs text-mut">{size(f.size)}</span>
                      </span>
                      <button
                        type="button"
                        className="btn !min-h-7 !text-[13px]"
                        aria-label={`Remove ${f.name}`}
                        onClick={() => void removeFile(f.name)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div>
                <input
                  ref={picker}
                  type="file"
                  multiple
                  className="sr-only"
                  aria-label="Choose knowledge files"
                  onChange={(e) => void addFiles(e.target.files)}
                />
                <button type="button" className="btn" onClick={() => picker.current?.click()}>
                  Add files
                </button>
              </div>
              <p className="m-0 text-xs text-mut">
                Up to 50 files of 25 MB each. A chat reads the ones that matter; each one it reads
                shows in the conversation.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  useStore.setState({ newChatProject: project.name })
                  setRoute("chat")
                }}
              >
                Start a chat in this project
              </button>
              {confirm ? (
                <span
                  className="flex items-center gap-2"
                  role="group"
                  aria-label="Confirm removing the project"
                >
                  <span className="font-semibold">Remove the project and its files?</span>
                  <button type="button" className="btn btn-deny" onClick={() => void remove()}>
                    Yes, remove it
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirm(false)}>
                    Keep it
                  </button>
                </span>
              ) : (
                <button type="button" className="btn btn-deny" onClick={() => setConfirm(true)}>
                  Remove this project
                </button>
              )}
            </div>
          </section>
        ) : (
          <p className="m-0 text-mut">Choose a project, or make one.</p>
        )}
      </div>
    </div>
  )
}

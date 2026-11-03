import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { download } from "../lib/exportMarkdown"
import { EmptyState } from "../components/EmptyState"
import { memoryAge, STALE_DAYS } from "../lib/memoryAge"

interface Entry {
  id: string
  topic: string
  text: string
  at: string
  by: "claude" | "you"
}
interface Memory {
  everyone: Entry[]
  projects: Record<string, Entry[]>
}

/**
 * What chats remember about you (owner's plan, W1-08). Everything Claude keeps with its remember tool is here, to read,
 * change and forget; you can add your own, and take it all away as Markdown or bring it back.
 */
export function MemoryPage() {
  const [memory, setMemory] = useState<Memory>()
  const [error, setError] = useState<string>()
  const [editing, setEditing] = useState<string>()
  const [draft, setDraft] = useState({ topic: "", text: "" })
  const [add, setAdd] = useState({ scope: "everyone", topic: "", text: "" })
  const picker = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const r = await api<Memory>("GET", "/api/memory")
    if (!r.ok || !r.data) return setError(r.error ?? "Memory could not be read")
    setMemory(r.data)
  }, [])
  useEffect(() => void load(), [load])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const r = await api("POST", "/api/memory", add)
    if (!r.ok) return toast.error(r.error ?? "That was not kept", { id: "memory" })
    setAdd({ ...add, topic: "", text: "" })
    toast("Kept", { id: "memory" })
    void load()
  }
  async function save(id: string) {
    const r = await api("PUT", `/api/memory/${id}`, draft)
    if (!r.ok) return toast.error(r.error ?? "That was not saved", { id: "memory" })
    setEditing(undefined)
    void load()
  }
  /** You checked an old memory and it still holds: its age starts again from today. */
  async function confirm(e: Entry) {
    const r = await api("PUT", `/api/memory/${e.id}`, { topic: e.topic, text: e.text })
    if (!r.ok) return toast.error(r.error ?? "That was not saved", { id: "memory" })
    toast("Marked as still true", { id: "memory" })
    void load()
  }
  async function forget(id: string) {
    const r = await api("DELETE", `/api/memory/${id}`)
    if (!r.ok) return toast.error(r.error ?? "That was not forgotten", { id: "memory" })
    toast("Forgotten", { id: "memory" })
    void load()
  }
  async function exportAll() {
    const r = await api<{ markdown: string }>("GET", "/api/memory-export")
    if (!r.ok || !r.data) return toast.error(r.error ?? "Nothing was exported", { id: "memory" })
    download("codehouse-memory.md", r.data.markdown)
  }
  async function importFile(file: File | undefined) {
    if (!file) return
    const r = await api<{ added: number; skipped: number }>("POST", "/api/memory-import", {
      markdown: await file.text(),
    })
    if (picker.current) picker.current.value = ""
    if (!r.ok || !r.data) return toast.error(r.error ?? "Nothing was imported", { id: "memory" })
    toast(`Added ${r.data.added}, skipped ${r.data.skipped} already there`, { id: "memory" })
    void load()
  }

  const scopes: Array<[string, string, Entry[]]> = memory
    ? [
        ["everyone", "For every chat", memory.everyone],
        ...Object.entries(memory.projects).map(
          ([p, list]) => [p, `Project: ${p}`, list] as [string, string, Entry[]],
        ),
      ]
    : []

  return (
    <div className="sheet mx-auto grid max-w-[900px] gap-5 p-6" aria-label="Memory">
      <div>
        <h1 className="m-0">Memory</h1>
        <p className="m-0 mt-1 max-w-[66ch] text-mut">
          What chats remember about you. A chat starts knowing these, and can keep, look up and
          forget them. Claude keeps a memory only when you ask or it will clearly help, and never a
          secret. Everything here is yours to change.
        </p>
      </div>
      {error ? (
        <p role="alert" className="m-0 font-semibold text-sev">
          {error}
        </p>
      ) : null}

      <form onSubmit={create} className="panel grid gap-2 p-3" aria-label="Keep something">
        <span className="font-semibold">Keep something</span>
        <div className="flex flex-wrap gap-2">
          <label className="grid gap-1">
            <span>For</span>
            <select
              className="field"
              value={add.scope}
              onChange={(e) => setAdd({ ...add, scope: e.target.value })}
            >
              <option value="everyone">Every chat</option>
              {Object.keys(memory?.projects ?? {}).map((p) => (
                <option key={p} value={p}>
                  Project: {p}
                </option>
              ))}
            </select>
          </label>
          <label className="grid min-w-[160px] flex-1 gap-1">
            <span>Topic</span>
            <input
              className="field"
              maxLength={60}
              value={add.topic}
              onChange={(e) => setAdd({ ...add, topic: e.target.value })}
            />
          </label>
        </div>
        <label className="grid gap-1">
          <span>What to keep</span>
          <textarea
            className="field"
            rows={2}
            maxLength={1000}
            value={add.text}
            onChange={(e) => setAdd({ ...add, text: e.target.value })}
          />
        </label>
        <div>
          <button className="btn btn-primary" disabled={!add.topic.trim() || !add.text.trim()}>
            Keep it
          </button>
        </div>
      </form>

      {memory === undefined ? <p className="m-0 text-mut">Loading…</p> : null}
      {scopes.map(([key, title, list]) => (
        <section key={key} aria-label={title} className="grid gap-2">
          <h2 className="m-0 text-[16px]">{title}</h2>
          {list.length === 0 ? (
            <EmptyState picture="empty-memory">
              <p className="m-0 text-mut">Nothing kept here yet.</p>
            </EmptyState>
          ) : null}
          <ul className="m-0 grid list-none gap-2 p-0">
            {list.map((e) => (
              <li key={e.id} className="panel grid gap-1.5 p-3">
                {editing === e.id ? (
                  <>
                    <input
                      className="field"
                      aria-label="Topic"
                      maxLength={60}
                      value={draft.topic}
                      onChange={(ev) => setDraft({ ...draft, topic: ev.target.value })}
                    />
                    <textarea
                      className="field"
                      aria-label="What is kept"
                      rows={2}
                      maxLength={1000}
                      value={draft.text}
                      onChange={(ev) => setDraft({ ...draft, text: ev.target.value })}
                    />
                    <span className="flex gap-2">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void save(e.id)}
                      >
                        Save
                      </button>
                      <button type="button" className="btn" onClick={() => setEditing(undefined)}>
                        Cancel
                      </button>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <strong>{e.topic}</strong>
                      <span className="text-xs text-mut">
                        {e.by === "you" ? "Added by you" : "Kept by Claude"},{" "}
                        {memoryAge(e.at).words}
                      </span>
                    </span>
                    <span>{e.text}</span>
                    {memoryAge(e.at).stale ? (
                      <span role="note" className="text-[13px] text-warn">
                        Over {STALE_DAYS} days old: is it still true? Chats are still told it until
                        you change or forget it.
                      </span>
                    ) : null}
                    <span className="flex gap-2">
                      {memoryAge(e.at).stale ? (
                        <button
                          type="button"
                          className="btn !min-h-7 !text-[13px]"
                          aria-label={`${e.topic} is still true`}
                          onClick={() => void confirm(e)}
                        >
                          Still true
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn !min-h-7 !text-[13px]"
                        aria-label={`Edit ${e.topic}`}
                        onClick={() => {
                          setEditing(e.id)
                          setDraft({ topic: e.topic, text: e.text })
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn !min-h-7 !text-[13px]"
                        aria-label={`Forget ${e.topic}`}
                        onClick={() => void forget(e.id)}
                      >
                        Forget
                      </button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" onClick={() => void exportAll()}>
          Export as Markdown
        </button>
        <input
          ref={picker}
          type="file"
          accept=".md,text/markdown,text/plain"
          className="sr-only"
          aria-label="Choose a memory file"
          onChange={(e) => void importFile(e.target.files?.[0])}
        />
        <button type="button" className="btn" onClick={() => picker.current?.click()}>
          Import from Markdown
        </button>
        <span className="text-xs text-mut">
          An import adds what is not already here, and leaves the rest alone.
        </span>
      </div>
    </div>
  )
}

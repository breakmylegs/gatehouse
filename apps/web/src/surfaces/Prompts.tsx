import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { variablesOf, type SavedPrompt } from "../lib/prompts"
import { titleOf } from "../lib/sessionActions"
import { useSessionList } from "../store"

/**
 * Your prompt library (W1-14): prompts you use again, with {{blanks}} filled in when you use them from the + menu.
 * Promote makes one a skill in a session's project, so Claude Code offers it there by name.
 */
export function Prompts() {
  const [list, setList] = useState<SavedPrompt[]>()
  const [draft, setDraft] = useState<{ id?: string; title: string; text: string }>({
    title: "",
    text: "",
  })
  const sessions = useSessionList().filter((s) => s.kind !== "chat" && s.state !== "ended")
  const load = useCallback(async () => {
    const r = await api<{ prompts: SavedPrompt[] }>("GET", "/api/prompts")
    setList(r.ok && r.data ? r.data.prompts : [])
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  async function save() {
    const r = await api("PUT", "/api/prompts", draft)
    if (!r.ok) return toast.error(r.error ?? "Not saved", { id: "prompts" })
    toast(draft.id ? "Prompt changed." : "Prompt saved.", { id: "prompts" })
    setDraft({ title: "", text: "" })
    await load()
  }
  async function remove(p: SavedPrompt) {
    const r = await api("DELETE", `/api/prompts/${p.id}`)
    if (!r.ok) return toast.error(r.error ?? "Not removed", { id: "prompts" })
    toast(`Removed ${p.title}.`, { id: "prompts" })
    await load()
  }
  async function promote(p: SavedPrompt, session: string) {
    const r = await api<{ skill: string; path: string }>("POST", `/api/prompts/${p.id}/promote`, {
      session,
    })
    if (!r.ok || !r.data) return toast.error(r.error ?? "Not made a skill", { id: "prompts" })
    toast(`${p.title} is now the skill ${r.data.skill} in that project (${r.data.path}).`, {
      id: "prompts",
    })
  }
  return (
    <div className="grid max-w-[900px] gap-5 p-6">
      <div>
        <h1 className="m-0">Prompts</h1>
        <p className="m-0 mt-1 text-mut">
          Prompts you use again. Use one from the + beside any prompt box. Write {"{{name}}"} for a
          blank to fill in each time.
        </p>
      </div>
      <form
        className="panel grid gap-2 p-4"
        aria-label={draft.id ? "Change a prompt" : "Add a prompt"}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <label className="grid gap-1">
          <span>Title</span>
          <input
            className="field"
            maxLength={80}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        <label className="grid gap-1">
          <span>Prompt</span>
          <textarea
            className="field"
            rows={4}
            maxLength={20000}
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          />
        </label>
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={!draft.title.trim() || !draft.text.trim()}>
            {draft.id ? "Save changes" : "Save prompt"}
          </button>
          {draft.id ? (
            <button type="button" className="btn" onClick={() => setDraft({ title: "", text: "" })}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>
      {list === undefined ? (
        <p className="m-0 text-mut">Reading your prompts…</p>
      ) : list.length === 0 ? (
        <p className="m-0 text-mut">No saved prompts yet.</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label="Your prompts">
          {list.map((p) => (
            <li key={p.id} className="panel grid gap-2 p-3">
              <strong>{p.title}</strong>
              <pre className="cmd max-h-32 overflow-auto !text-[13px]">{p.text}</pre>
              {variablesOf(p.text).length ? (
                <span className="text-[12.5px] text-mut">
                  Asks for {variablesOf(p.text).join(", ")} when used.
                </span>
              ) : null}
              <span className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn !min-h-7"
                  onClick={() => setDraft({ id: p.id, title: p.title, text: p.text })}
                >
                  Change
                </button>
                <button type="button" className="btn !min-h-7" onClick={() => void remove(p)}>
                  Remove
                </button>
                {sessions.length ? (
                  <label className="flex items-center gap-1.5 text-[13px]">
                    <span>Make it a skill in</span>
                    <select
                      className="field !min-h-7"
                      value=""
                      aria-label={`Make ${p.title} a skill in a project`}
                      onChange={(e) => e.target.value && void promote(p, e.target.value)}
                    >
                      <option value="">a running session's project…</option>
                      {sessions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {titleOf(s)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

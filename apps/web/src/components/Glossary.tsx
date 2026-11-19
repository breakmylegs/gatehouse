import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { useSessionList } from "../store"

/**
 * D-083: the project's own words, from the names in its code, and the places it uses two words for one thing, so
 * one can be chosen and kept.
 */
interface Data {
  scope: { root: string; files: number; names: number }
  terms: Array<{ word: string; names: number; example: { name: string; file: string } }>
  clashes: Array<{ words: Array<{ word: string; names: number; examples: Array<{ name: string; file: string }> }>; keep: string; from: "built-in" | "project" }>
}

export function clashText(c: Data["clashes"][number]): string {
  const parts = c.words.map((w) => `${w.word} (${w.names} name${w.names === 1 ? "" : "s"}, such as ${w.examples[0]?.name ?? w.word})`)
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]} look like one thing. ${c.from === "project" ? "Your glossary keeps" : "Most names use"} ${c.keep}.`
}

export function Glossary() {
  const sessions = useSessionList()
  const folders = useMemo(() => {
    const seen = new Map<string, { id: string; project: string }>()
    for (const s of sessions) if (s.state !== "ended" && !seen.has(s.cwd)) seen.set(s.cwd, { id: s.id, project: s.project })
    return [...seen.values()]
  }, [sessions])
  const [chosen, setChosen] = useState<string>()
  const id = chosen ?? folders[0]?.id
  const [d, setD] = useState<Data>()
  const [busy, setBusy] = useState(false)
  useEffect(() => setD(undefined), [id])
  if (!folders.length) return null
  const look = async () => {
    if (!id) return
    setBusy(true)
    const r = await api<Data>("GET", `/api/insights/glossary?session=${encodeURIComponent(id)}`)
    setBusy(false)
    if (r.ok && r.data) setD(r.data)
    else toast.error(r.error ?? "The names could not be read.", { id: "gloss" })
  }
  return (
    <section aria-label="The project's words" className="grid gap-2">
      <h2 className="m-0 text-[18px]">The project's words</h2>
      <p className="m-0 max-w-[720px] text-[13px] text-mut">
        The words the code names things with, and where it uses two words for one thing. Add your own groups to .codehouse/glossary.yml (synonyms, the word to keep first).
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="text-[13px] text-mut">Project</span>
          <select className="field" value={id} onChange={(e) => setChosen(e.target.value)}>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.project}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" disabled={busy} onClick={() => void look()}>
          {busy ? "Reading the names..." : "Read the names"}
        </button>
      </div>
      {d ? (
        <>
          <p className="m-0" role="status">
            {d.scope.names.toLocaleString("en-GB")} names in {d.scope.files} files: {d.clashes.length ? `${d.clashes.length} pair${d.clashes.length === 1 ? "" : "s"} of words for one thing.` : "no two words for one thing."}
          </p>
          {d.clashes.length ? (
            <ul className="m-0 grid list-none gap-1 p-0 text-[13px]">
              {d.clashes.map((c) => (
                <li key={c.words.map((w) => w.word).join("+")}>{clashText(c)}</li>
              ))}
            </ul>
          ) : null}
          {d.terms.length ? (
            <p className="m-0 text-[13px] text-mut">
              Its main words: {d.terms.slice(0, 20).map((t) => `${t.word} (${t.names})`).join(", ")}.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

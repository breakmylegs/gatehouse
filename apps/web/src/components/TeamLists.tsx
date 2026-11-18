import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"

interface ListView {
  name: string
  source: string
  date: string
  words: number
  importedAt: string
}

/**
 * E-080: your team's redaction lists. Each is shown with its source and date and how many words it hides (never the
 * words). Importing takes the list and its signature; one not signed with a trusted key, or that would remove a word,
 * is refused and says why.
 */
export function TeamLists() {
  const [lists, setLists] = useState<ListView[]>([])
  const [trusted, setTrusted] = useState(0)
  const [list, setList] = useState<string>()
  const [sig, setSig] = useState<string>()
  const load = async () => {
    const r = await api<{ lists: ListView[]; trustedKeys: number }>("GET", "/api/redaction-lists")
    if (r.ok && r.data) {
      setLists(r.data.lists)
      setTrusted(r.data.trustedKeys)
    }
  }
  useEffect(() => {
    void load()
  }, [])
  const read = (set: (t: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) void f.text().then(set)
  }
  const importIt = async () => {
    if (!list || !sig) return
    const r = await api<{ name: string; words: number }>("POST", "/api/redaction-lists", { list, signature: sig })
    if (r.ok && r.data) {
      toast(`Imported ${r.data.name}: ${r.data.words} words are hidden from now on.`, { id: "teamlist" })
      setList(undefined)
      setSig(undefined)
      void load()
    } else toast.error(r.error ?? "The list was not imported.", { id: "teamlist" })
  }
  return (
    <div className="grid gap-2">
      {lists.length ? (
        <ul className="m-0 grid list-none gap-1 p-0 text-[14px]">
          {lists.map((l) => (
            <li key={l.name}>
              <strong>{l.name}</strong>, from {l.source}, dated {l.date}: {l.words} {l.words === 1 ? "word" : "words"}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[13px] text-mut">No team list is imported.</p>
      )}
      {trusted ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-[13px]">
            The list (JSON)
            <input type="file" accept=".json,application/json" onChange={read(setList)} />
          </label>
          <label className="grid gap-1 text-[13px]">
            Its signature
            <input type="file" accept=".sig,.txt" onChange={read(setSig)} />
          </label>
          <button type="button" className="btn" disabled={!list || !sig} onClick={() => void importIt()}>
            Import
          </button>
        </div>
      ) : (
        <p className="m-0 text-[13px] text-mut">Add your team's public key below first: a list is only imported when it is signed with one.</p>
      )}
    </div>
  )
}

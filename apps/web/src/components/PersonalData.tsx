import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { useSessionList } from "../store"

/**
 * D-051: the personal data flow map of a project, a draft: the fields that look like personal data, and where each
 * goes (a log, storage, a network call), with the draft for legal review to copy.
 */
interface DataMap {
  draft: true
  scope: { root: string; files: number; skipped: string[] }
  fields: Array<{ name: string; category: string; places: number }>
  flows: Array<{ field: string; sink: string; file: string; line: number }>
  markdown: string
}
const TO: Record<string, string> = { log: "a log", storage: "storage", network: "a network call" }

export function PersonalData() {
  const sessions = useSessionList()
  const folders = useMemo(() => {
    const seen = new Map<string, { id: string; project: string }>()
    for (const s of sessions) if (s.state !== "ended" && !seen.has(s.cwd)) seen.set(s.cwd, { id: s.id, project: s.project })
    return [...seen.values()]
  }, [sessions])
  const [chosen, setChosen] = useState<string>()
  const id = chosen ?? folders[0]?.id
  const [map, setMap] = useState<DataMap>()
  const [busy, setBusy] = useState(false)
  useEffect(() => setMap(undefined), [id])
  if (!folders.length) return null
  const look = async () => {
    if (!id) return
    setBusy(true)
    const r = await api<DataMap>("GET", `/api/insights/personal-data?session=${encodeURIComponent(id)}`)
    setBusy(false)
    if (r.ok && r.data) setMap(r.data)
    else toast.error(r.error ?? "The map could not be made.", { id: "pii" })
  }
  return (
    <section aria-label="Personal data" className="grid gap-2">
      <h2 className="m-0 text-[18px]">Personal data (a draft)</h2>
      <p className="m-0 max-w-[720px] text-[13px] text-mut">
        Fields that look like personal data by their names, and where each goes on the same line: a log, storage or a network call. A draft: a name can mislead, and a flow through another function is not followed.
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
          {busy ? "Reading the code..." : "Make the map"}
        </button>
        {map ? (
          <button
            type="button"
            className="btn"
            onClick={() =>
              void navigator.clipboard
                .writeText(map.markdown)
                .then(() => toast.success("Copied the draft for legal review", { id: "pii" }))
                .catch(() => toast.error("It could not be copied", { id: "pii" }))
            }
          >
            Copy the draft for legal review
          </button>
        ) : null}
      </div>
      {map ? (
        <>
          <p className="m-0" role="status">
            {map.scope.files} source files read: {map.fields.length} field{map.fields.length === 1 ? "" : "s"} that look like personal data, going to {map.flows.length} place{map.flows.length === 1 ? "" : "s"}.
          </p>
          {map.flows.length ? (
            <ul className="m-0 grid list-none gap-0.5 p-0 text-[13px]">
              {map.flows.slice(0, 50).map((f) => (
                <li key={`${f.file}:${f.line}:${f.field}`}>
                  <span className="font-semibold">{f.field}</span> goes to {TO[f.sink] ?? f.sink}, <span className="mono">{f.file}</span> line {f.line}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

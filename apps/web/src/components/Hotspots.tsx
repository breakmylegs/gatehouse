import { useEffect, useMemo, useState } from "react"
import { api } from "../lib/api"
import { useSessionList } from "../store"

/**
 * D-069: the hotspot map of a project: the files most worth attention, by how often they change (git, 90 days), how
 * tangled they are, and how often agent work on them goes wrong. Each number is shown, not only the order.
 */
interface Hotspot {
  file: string
  churn: number
  complexity: number
  failures: number
  score: number
}

export function Hotspots() {
  const sessions = useSessionList()
  // One open session for each folder.
  const folders = useMemo(() => {
    const seen = new Map<string, { id: string; project: string }>()
    for (const s of sessions) if (s.state !== "ended" && !seen.has(s.cwd)) seen.set(s.cwd, { id: s.id, project: s.project })
    return [...seen.values()]
  }, [sessions])
  const [chosen, setChosen] = useState<string>()
  const id = chosen ?? folders[0]?.id
  const [rows, setRows] = useState<Hotspot[]>()
  const [note, setNote] = useState<string>()
  useEffect(() => {
    if (!id) return
    setRows(undefined)
    void api<{ hotspots: Hotspot[] }>("GET", `/api/insights/hotspots?session=${encodeURIComponent(id)}`).then((r) => {
      if (r.ok && r.data) {
        setRows(r.data.hotspots)
        setNote(undefined)
      } else setNote(r.error ?? "The hotspots could not be worked out.")
    })
  }, [id])
  return (
    <section aria-label="Hotspots" className="grid gap-2">
      <h2 className="m-0 text-[18px]">Hotspots</h2>
      {!folders.length ? (
        <p className="m-0 text-mut">Open a session in a project to see its hotspots.</p>
      ) : (
        <>
          <label className="grid w-fit gap-1">
            <span className="text-[13px] text-mut">Project</span>
            <select className="field" value={id} onChange={(e) => setChosen(e.target.value)}>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.project}
                </option>
              ))}
            </select>
          </label>
          <p className="m-0 text-[13px] text-mut">Ranked by changes in the last 90 days, decision points in the code, and agent calls on the file that failed or were put back.</p>
          {note ? <p className="m-0 text-mut">{note}</p> : null}
          {rows && !rows.length ? <p className="m-0 text-mut">Nothing stands out: no file has changed or caused trouble lately.</p> : null}
          {rows?.length ? (
            <table className="w-full border-collapse text-[13px]">
              <caption className="sr-only">Hotspots, most worth attention first</caption>
              <thead>
                <tr>
                  <th scope="col" className="text-left">
                    File
                  </th>
                  <th scope="col" className="px-2 text-right font-normal text-mut">
                    Changes
                  </th>
                  <th scope="col" className="px-2 text-right font-normal text-mut">
                    Decision points
                  </th>
                  <th scope="col" className="px-2 text-right font-normal text-mut">
                    Agent trouble
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 15).map((h) => (
                  <tr key={h.file} className="border-t border-line">
                    <th scope="row" className="mono py-1 text-left font-normal">
                      {h.file}
                    </th>
                    <td className="px-2 text-right tabular-nums">{h.churn}</td>
                    <td className="px-2 text-right tabular-nums">{h.complexity}</td>
                    <td className="px-2 text-right tabular-nums">{h.failures}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      )}
    </section>
  )
}

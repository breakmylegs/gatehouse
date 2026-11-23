import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { useSessionList } from "../store"

/** E-065: a project's DORA and NIS2 evidence index, a draft: each control area with its evidence, or a gap. */
interface Row {
  control: { framework: string; ref: string; title: string }
  evidence: Array<{ name: string; detail: string }>
  gap: boolean
  wouldServe: string
}

export function ComplianceIndex({ days }: { days: number }) {
  const sessions = useSessionList()
  const folders = useMemo(() => {
    const seen = new Map<string, { id: string; project: string }>()
    for (const s of sessions) if (s.state !== "ended" && s.kind !== "chat" && !seen.has(s.cwd)) seen.set(s.cwd, { id: s.id, project: s.project })
    return [...seen.values()]
  }, [sessions])
  const [chosen, setChosen] = useState<string>()
  const id = chosen ?? folders[0]?.id
  const [r, setR] = useState<{ rows: Row[]; markdown: string }>()
  const [busy, setBusy] = useState(false)
  useEffect(() => setR(undefined), [id, days])
  if (!folders.length) return null
  const look = async () => {
    if (!id) return
    setBusy(true)
    const x = await api<{ rows: Row[]; markdown: string }>("GET", `/api/insights/compliance-index?session=${encodeURIComponent(id)}&days=${days}`)
    setBusy(false)
    if (x.ok && x.data) setR(x.data)
    else toast.error(x.error ?? "The index could not be made.", { id: "dora" })
  }
  const gaps = r?.rows.filter((x) => x.gap).length ?? 0
  return (
    <section aria-label="DORA and NIS2 evidence" className="grid gap-2">
      <h2 className="m-0 text-[18px]">DORA and NIS2 evidence (a draft)</h2>
      <p className="m-0 max-w-[720px] text-[13px] text-mut">What Codehouse holds for a project in the period, mapped to the control areas, with the gaps. For an assessor to check; not legal advice.</p>
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
          {busy ? "Reading the records..." : "Make the index"}
        </button>
        {r ? (
          <button type="button" className="btn" onClick={() => void navigator.clipboard.writeText(r.markdown).then(() => toast.success("Copied the evidence index", { id: "dora" }))}>
            Copy the index
          </button>
        ) : null}
      </div>
      {r ? (
        <>
          <p className="m-0" role="status">
            {r.rows.length - gaps} of {r.rows.length} control areas link to evidence; {gaps} {gaps === 1 ? "is a gap" : "are gaps"}.
          </p>
          <ul className="m-0 grid list-none gap-0.5 p-0 text-[13px]">
            {r.rows.map((x) => (
              <li key={`${x.control.framework} ${x.control.ref}`}>
                <strong>
                  {x.control.framework} {x.control.ref}
                </strong>{" "}
                {x.control.title}: {x.gap ? <span className="font-semibold">Gap</span> : <span className="text-mut">{x.evidence.map((e) => e.name).join("; ")}</span>}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

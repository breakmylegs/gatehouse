import { useEffect, useState } from "react"
import { api } from "../lib/api"

/**
 * D-072: what went wrong in agent work over the period, from the audit alone: each kind with its count, then by
 * project and by model, so you can see where sessions struggle and on which model. Words with every number. D-078:
 * how often each model's done-claims held when they were checked.
 */
const KINDS = ["loop", "tool-error", "failing-test", "undo", "contradicted-claim", "denial"] as const
type Kind = (typeof KINDS)[number]
const WORD: Record<Kind, string> = {
  loop: "Went round in circles",
  "tool-error": "A tool call failed",
  "failing-test": "Tests failed",
  undo: "Edits put back",
  "contradicted-claim": "Said it was done, and it was not",
  denial: "Refused",
}
interface Row {
  total: number
  byKind: Record<Kind, number>
}
interface Taxonomy {
  total: number
  byKind: Record<Kind, number>
  byProject: Array<Row & { project: string }>
  byModel: Array<Row & { model: string }>
  calibration?: Calibration[]
}
interface Calibration {
  model: string
  verified: number
  contradicted: number
  unverified: number
  flaky: number
  score?: number
  few: boolean
}

/** D-078: a model's claim calibration in words. */
export function calibrationText(c: Calibration): string {
  const checked = c.verified + c.contradicted
  if (c.score === undefined) return `No claim of ${c.model}'s could be checked yet (${c.unverified} unchecked).`
  const extra = [c.unverified ? `${c.unverified} could not be checked` : "", c.flaky ? `${c.flaky} met flaky tests` : ""].filter(Boolean).join(", ")
  return `${Math.round(c.score * 100)}% of ${c.model}'s checked claims held (${c.verified} of ${checked})${extra ? `; ${extra}` : ""}${c.few ? ". Too few to go on yet" : ""}.`
}

function Table({ label, rows }: { label: string; rows: Array<Row & { name: string }> }) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <caption className="text-left font-semibold">{label}</caption>
      <thead>
        <tr>
          <th scope="col" className="text-left">
            {label === "By project" ? "Project" : "Model"}
          </th>
          {KINDS.map((k) => (
            <th key={k} scope="col" className="px-2 text-right font-normal text-mut">
              {WORD[k]}
            </th>
          ))}
          <th scope="col" className="px-2 text-right">
            All
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 12).map((r) => (
          <tr key={r.name} className="border-t border-line">
            <th scope="row" className="py-1 text-left font-normal">
              {r.name}
            </th>
            {KINDS.map((k) => (
              <td key={k} className="px-2 text-right tabular-nums">
                {r.byKind[k] || ""}
              </td>
            ))}
            <td className="px-2 text-right font-semibold tabular-nums">{r.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function FailureTaxonomy({ days }: { days: number }) {
  const [t, setT] = useState<Taxonomy>()
  useEffect(() => {
    void api<Taxonomy>("GET", `/api/insights/failures?days=${days}`).then((r) => setT(r.ok ? r.data : undefined))
  }, [days])
  if (!t) return null
  return (
    <section aria-label="What went wrong" className="grid gap-3">
      <h2 className="m-0 text-[18px]">What went wrong</h2>
      {t.total === 0 ? (
        <p className="m-0 text-mut">Nothing went wrong in this period that the audit log shows.</p>
      ) : (
        <>
          <ul className="m-0 grid list-none gap-1 p-0 sm:grid-cols-3">
            {KINDS.filter((k) => t.byKind[k]).map((k) => (
              <li key={k}>
                <span className="font-semibold tabular-nums">{t.byKind[k]}</span> {WORD[k].toLowerCase()}
              </li>
            ))}
          </ul>
          <Table label="By project" rows={t.byProject.map((p) => ({ ...p, name: p.project }))} />
          <Table label="By model" rows={t.byModel.map((m) => ({ ...m, name: m.model }))} />
        </>
      )}
      {t.calibration?.length ? (
        <div className="grid gap-1">
          <h3 className="m-0 text-[15px]">How often each model's "done" held</h3>
          <ul className="m-0 grid list-none gap-0.5 p-0 text-[13px]">
            {t.calibration.map((c) => (
              <li key={c.model}>{calibrationText(c)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

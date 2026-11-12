import { useState } from "react"

/** D-026: the Host's refusal of rules that would allow what was refused or asked about in the last 90 days. */
export interface Regression {
  total: number
  phrase: string
  changes: Array<{
    line: number
    summary: string
    before: { outcome: string; ruleId: string }
    after: { outcome: string; ruleId: string }
  }>
}

/** The regression in a refusal from the Host, if that is why it refused. */
export const regressionIn = (detail: unknown): Regression | undefined =>
  (detail as { regression?: Regression } | undefined)?.regression

/** The calls the new rules would allow, and the phrase that saves them anyway. */
export function RegressionConfirm({
  regression,
  busy,
  onConfirm,
}: {
  regression: Regression
  busy: boolean
  onConfirm: (phrase: string) => void
}) {
  const [typed, setTyped] = useState("")
  return (
    <section aria-label="Would allow what was refused" className="panel grid gap-2 p-4">
      <h2 className="m-0 text-sm font-semibold">
        {regression.changes.length === 1
          ? "1 past call that was refused or asked about would now be allowed"
          : `${regression.changes.length} past calls that were refused or asked about would now be allowed`}
      </h2>
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {regression.changes.map((c) => (
          <li key={c.line} className="grid grid-cols-[1fr_auto] gap-3">
            <span className="mono [overflow-wrap:anywhere]">{c.summary}</span>
            <span>
              {c.before.outcome} to <strong>{c.after.outcome}</strong> ({c.after.ruleId})
            </span>
          </li>
        ))}
      </ul>
      <label className="grid gap-1">
        <span>
          To save them anyway, type <strong className="mono">{regression.phrase}</strong>
        </span>
        <input
          className="field mono"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <button
        className="btn justify-self-start"
        disabled={busy || typed !== regression.phrase}
        onClick={() => onConfirm(typed)}
      >
        Save them anyway
      </button>
    </section>
  )
}

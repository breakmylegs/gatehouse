import { useState } from "react"
import { send } from "../store"

interface Result {
  first?: { sha: string; subject: string; session?: string }
  steps: number
  notFound?: string
}

/** E-044: git bisect with a check command, in a scratch worktree; your working tree is never touched. */
export function BisectPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [good, setGood] = useState("")
  const [bad, setBad] = useState("HEAD")
  const [check, setCheck] = useState("npm test")
  const [busy, setBusy] = useState(false)
  const [r, setR] = useState<Result>()
  const [error, setError] = useState<string>()
  async function go() {
    setBusy(true)
    setError(undefined)
    const x = await send({ type: "bisect", sessionId, good: good.trim(), bad: bad.trim(), check: check.trim() })
    setBusy(false)
    if (x.ok) setR(x.data as Result)
    else setError(x.error?.message ?? "It did not run")
  }
  return (
    <section aria-label="Find the bad commit" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Find the bad commit</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="text-xs text-mut">Last good commit</span>
          <input className="field mono" value={good} onChange={(e) => setGood(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-mut">First bad commit</span>
          <input className="field mono" value={bad} onChange={(e) => setBad(e.target.value)} />
        </label>
        <label className="grid flex-1 gap-1">
          <span className="text-xs text-mut">Check (exit 0 is good)</span>
          <input className="field mono" value={check} onChange={(e) => setCheck(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary !min-h-7" disabled={busy || !good.trim() || !bad.trim() || !check.trim()} onClick={() => void go()}>
          {busy ? "Bisecting…" : "Bisect"}
        </button>
      </div>
      <p className="m-0 text-xs text-mut">
        In a scratch worktree, so your working tree and uncommitted changes are never touched; git bisect and the check run
        as Codehouse actions, judged by your rules. The worktree is removed afterwards, its links first.
      </p>
      {error ? <p className="m-0">{error}</p> : null}
      {r?.first ? (
        <p className="m-0">
          The first bad commit is <span className="mono">{r.first.sha.slice(0, 10)}</span>, {r.first.subject}
          {r.first.session ? ` (made in Codehouse session ${r.first.session})` : ""}, found in {r.steps} step(s).
        </p>
      ) : r ? (
        <p className="m-0">Not found: {r.notFound}</p>
      ) : null}
    </section>
  )
}

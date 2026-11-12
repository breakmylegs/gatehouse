import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

/**
 * D-059: what a project tells Claude (CLAUDE.md, AGENTS.md, Claude's settings, skills, commands and agents), changed
 * outside Codehouse since it was pinned. No session starts there, and no turn, until you read the change here and
 * approve it. Shown only when something changed.
 */

export interface InstructionChange {
  path: string
  kind: "changed" | "added" | "removed"
  diff?: string[]
}

interface State {
  changes: InstructionChange[]
  unreadable: boolean
}

/** The lines that changed, with two lines around each, so a long file shows only what matters. */
function shown(diff: string[]): Array<string | null> {
  const keep = new Set<number>()
  diff.forEach((l, i) => {
    if (l[0] !== " ") for (let k = i - 2; k <= i + 2; k++) keep.add(k)
  })
  const out: Array<string | null> = []
  let gap = false
  diff.forEach((l, i) => {
    if (keep.has(i)) {
      out.push(l)
      gap = false
    } else if (!gap) {
      out.push(null)
      gap = true
    }
  })
  return out
}

export function InstructionsReview({ cwd, nonce = 0, onApproved }: { cwd: string; nonce?: number; onApproved?: () => void }) {
  const [st, setSt] = useState<State>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    void send({ type: "instructions_state", cwd }).then((r) => {
      const d = r.data as State | undefined
      if (live && r.ok && Array.isArray(d?.changes)) setSt(d)
    })
    return () => {
      live = false
    }
  }, [cwd, nonce])
  if (!st?.changes.length) return null
  const approve = () => {
    setBusy(true)
    void send({ type: "instructions_approve", cwd }).then((r) => {
      setBusy(false)
      if (!r.ok) return void toast.error(r.error?.message ?? "The change was not approved")
      const d = r.data as State | undefined
      setSt(Array.isArray(d?.changes) ? d : { changes: [], unreadable: false })
      toast("Approved. Sessions here can carry on.")
      onApproved?.()
    })
  }
  return (
    <section role="alert" aria-label="Instructions changed outside Codehouse" className="grid gap-2 rounded-md border border-warn bg-s1 p-3 text-[14px]">
      <strong>What this project tells Claude changed outside Codehouse</strong>
      <p className="m-0 text-[13px]">
        {st.unreadable
          ? "The record of what was pinned could not be checked, so every instruction file is shown. "
          : "A pull, another editor or a checkout changed these since they were pinned. "}
        No session starts here, and no turn, until you have read the change and approved it.
      </p>
      {st.changes.map((c) => (
        <details key={c.path} open={st.changes.length <= 3}>
          <summary className="mono cursor-pointer text-[13px]">
            {c.path} <span className="text-mut">({c.kind === "added" ? "new" : c.kind === "removed" ? "removed" : "changed"})</span>
          </summary>
          {c.diff ? (
            <pre className="mono m-0 mt-1 max-h-72 overflow-auto rounded bg-s2 p-2 text-[12px]">
              {shown(c.diff).map((l, i) =>
                l === null ? (
                  <div key={i} className="text-mut">
                    ...
                  </div>
                ) : (
                  <div key={i} className={l[0] === "+" ? "text-ok" : l[0] === "-" ? "text-sev" : ""}>
                    {l}
                  </div>
                ),
              )}
            </pre>
          ) : (
            <p className="m-0 mt-1 text-[13px] text-mut">Too large to show, or no copy of the earlier version was kept. Open the file to read it.</p>
          )}
        </details>
      ))}
      <div>
        <button type="button" className="btn btn-primary !min-h-7" disabled={busy} onClick={approve}>
          I have read it: approve the change
        </button>
      </div>
    </section>
  )
}

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { api, download } from "../lib/api"
import { send } from "../store"

/**
 * D-003: a change's evidence, in one pack: the decisions and approvals, the commands and how each ended, the checked
 * claims and sealed checks, the dependency changes, what the local analysis found and the files, each tied to its audit
 * record. Gather now makes one for what changed since the session's first checkpoint; Export, signed gives it inside
 * the session's signed timeline export, which both verifiers check.
 */

interface Pack {
  createdAt: string
  range: { from: { label: string; createdAt: string }; commit?: string }
  decisions: Array<{ seq: number; tool: string; summary: string; outcome: string; ruleId: string; decidedBy: string }>
  commands: Array<{ seq: number; command: string; result: string; exitCode?: number }>
  claims: Array<{ seq: number; claim: { kind?: string; outcome?: string } }>
  sealedChecks: { runs: number }
  dependencies: { added: number; changed: number; removed: number; sbom?: string }
  findings: Array<{ file: string; line: number; severity: string; title: string }>
  files: Array<{ path: string; change: string; added: number; removed: number }>
  notes: string[]
}

const WHO: Record<string, string> = {
  rules: "your rules",
  "human-desktop": "you",
  "human-phone": "your phone",
  "human-push": "a push answer",
  "extreme-mode": "Extreme approval",
  floor: "the floor",
  judge: "the judge",
  timeout: "no answer in time",
}

export function Evidence({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [packs, setPacks] = useState<Array<{ sha: string; pack: Pack }>>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const r = await api<{ packs: Array<{ sha: string; pack: Pack }> }>("GET", `/api/evidence?session=${encodeURIComponent(sessionId)}`)
    if (r.ok && r.data) setPacks(r.data.packs)
    else setError(r.error ?? "The evidence could not be read")
  }, [sessionId])
  useEffect(() => void load(), [load])
  const newest = packs?.[0]
  return (
    <section aria-label="Evidence" className="panel grid gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-[17px]">Evidence</h2>
        <span className="text-[13px] text-mut">What shows this change was done properly, tied to the audit log.</span>
        <button
          type="button"
          className="btn ml-auto !min-h-7"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const r = await send({ type: "evidence_build", sessionId })
            setBusy(false)
            if (!r.ok) return void toast.error(r.error?.message ?? "The evidence could not be gathered")
            await load()
          }}
        >
          Gather now
        </button>
        {newest ? (
          <button
            type="button"
            className="btn !min-h-7"
            onClick={async () => {
              const day = new Date().toISOString().slice(0, 10)
              const e = await download(
                `/api/timeline/export?session=${encodeURIComponent(sessionId)}&evidence=${newest.sha}`,
                `codehouse-evidence-${day}.zip`,
              )
              if (e) return void toast.error(e)
              toast("Exported, signed, with the session's timeline and the records the evidence names.")
            }}
          >
            Export, signed
          </button>
        ) : null}
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sev">
          {error}
        </p>
      ) : packs === undefined ? (
        <p className="m-0 text-[13.5px] text-mut">Reading…</p>
      ) : !newest ? (
        <p className="m-0 text-[13.5px] text-mut">
          No evidence pack yet. One is made with each commit the session makes, or choose Gather now.
        </p>
      ) : (
        <PackView pack={newest.pack} sha={newest.sha} />
      )}
    </section>
  )
}

function PackView({ pack, sha }: { pack: Pack; sha: string }) {
  const failed = pack.commands.filter((c) => c.result === "failed").length
  return (
    <div className="grid gap-3 text-[13px]">
      <p className="m-0 text-mut">
        Since {pack.range.from.label}, {new Date(pack.range.from.createdAt).toLocaleString("en-GB")}
        {pack.range.commit ? `, to commit ${pack.range.commit.slice(0, 10)}` : ""}. Made{" "}
        {new Date(pack.createdAt).toLocaleString("en-GB")}. Pack <span className="mono">{sha.slice(0, 16)}</span>.
      </p>
      <Part title={`Decisions and approvals (${pack.decisions.length})`}>
        {pack.decisions.slice(-40).map((d) => (
          <li key={d.seq}>
            <span className="mono text-mut">Record {d.seq}</span> <strong>{d.tool}</strong> {d.summary ? <span className="mono">{d.summary}</span> : null}:{" "}
            <span className={d.outcome === "deny" ? "text-sev" : ""}>
              {d.outcome}, by {WHO[d.decidedBy] ?? d.decidedBy}, rule {d.ruleId}
            </span>
          </li>
        ))}
      </Part>
      <Part title={`Commands (${pack.commands.length}${failed ? `, ${failed} failed` : ""})`}>
        {pack.commands.slice(-40).map((c) => (
          <li key={c.seq}>
            <span className="mono">{c.command}</span>:{" "}
            <span className={c.result === "failed" ? "text-sev" : c.result === "not seen" ? "text-mut" : ""}>
              {c.result}
              {c.exitCode !== undefined && c.result === "failed" ? `, exit ${c.exitCode}` : ""}
            </span>
          </li>
        ))}
      </Part>
      <Part title={`Checked claims (${pack.claims.length}), sealed checks run (${pack.sealedChecks.runs})`}>
        {pack.claims.map((c) => (
          <li key={c.seq}>
            {c.claim.kind ?? "A claim"}: {c.claim.outcome ?? "checked"}
          </li>
        ))}
      </Part>
      <Part
        title={`Dependencies: ${pack.dependencies.added} added, ${pack.dependencies.changed} changed, ${pack.dependencies.removed} removed`}
      >
        {null}
      </Part>
      <Part title={`What the local analysis found (${pack.findings.length})`}>
        {pack.findings.map((x) => (
          <li key={`${x.file}:${x.line}:${x.title}`}>
            <span className={x.severity === "Severe" ? "font-semibold text-sev" : "font-semibold text-warn"}>{x.severity}</span> {x.title},{" "}
            <span className="mono">{x.file}</span> line {x.line}
          </li>
        ))}
      </Part>
      <Part title={`Files (${pack.files.length})`}>
        {pack.files.map((f) => (
          <li key={f.path}>
            <span className="mono">{f.path}</span> {f.change}, +{f.added} -{f.removed}
          </li>
        ))}
      </Part>
      {pack.notes.length ? (
        <ul className="m-0 grid list-none gap-1 p-0 text-mut">
          {pack.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : children ? [children] : []
  return (
    <div className="grid gap-1">
      <h3 className="m-0 text-[13.5px] font-semibold">{title}</h3>
      {items.length ? <ul className="m-0 grid list-none gap-1 p-0">{children}</ul> : null}
    </div>
  )
}

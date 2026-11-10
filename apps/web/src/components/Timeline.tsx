import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { api, download } from "../lib/api"
import { send, useStore } from "../store"

/**
 * C-010: everything a session did, from the audit log, in its order: each call with the decision it ended in, the rule,
 * the risk and who decided, its records (Open record), the checkpoint taken while it waited, its file's change against
 * the checkpoint before it, and Try in policy, which puts the call into Try a request on the Approver page.
 */

export interface TimelineEntry {
  seq: number
  at: string
  kind: "call" | "event"
  event: string
  tool: string
  toolUseId?: string
  summary: string
  outcome: string
  ruleId: string
  risk: number
  decidedBy: string
  channel: string
  records: number[]
  file?: string
  checkpoint?: { ref: string; label: string; createdAt: string }
}

const WHO: Record<string, string> = {
  "human-desktop": "you, on this computer",
  "human-phone": "you, on your phone",
  "human-push": "you, from a notification",
  "extreme-mode": "Extreme approval",
  judge: "the judge",
  rules: "your rules",
  floor: "the always-blocked list",
  timeout: "nobody in time",
}

export const decided = (e: TimelineEntry) =>
  `${e.outcome === "allow" ? "Allowed" : e.outcome === "deny" ? "Denied" : "Asked"} by ${WHO[e.decidedBy] ?? e.decidedBy}`

/** One file's part of a unified diff. */
export function fileSection(diff: string, file: string): string {
  const want = file.replace(/\\/g, "/").toLowerCase()
  const parts = diff.split(/^(?=diff --git )/m)
  return parts.find((p) => {
    const head = p.split("\n")[0]?.toLowerCase() ?? ""
    const b = / b\/(.+)$/.exec(head)?.[1]
    return b !== undefined && (want.endsWith(`/${b}`) || want === b)
  }) ?? ""
}

export function Timeline({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const session = useStore((s) => s.sessions[sessionId])
  const setRoute = useStore((s) => s.setRoute)
  const [entries, setEntries] = useState<TimelineEntry[]>()
  const [error, setError] = useState<string>()
  const [shown, setShown] = useState<{ seq: number; text: string }>()
  useEffect(() => {
    void api<{ entries: TimelineEntry[] }>("GET", `/api/timeline?session=${encodeURIComponent(sessionId)}`).then((r) => {
      if (r.ok && r.data) setEntries(r.data.entries)
      else setError(r.error ?? "The timeline could not be read")
    })
  }, [sessionId])
  // The checkpoint before each entry: its own, or the last one taken before it.
  const before = useMemo(() => {
    const out = new Map<number, string>()
    let last: string | undefined
    for (const e of entries ?? []) {
      if (e.checkpoint) last = e.checkpoint.ref
      if (last) out.set(e.seq, last)
    }
    return out
  }, [entries])
  const cwd = session?.cwd ?? ""
  const title = session?.title ?? session?.project ?? "this session"
  const openRecord = (seq: number) => {
    useStore.setState({ auditOpen: seq })
    setRoute("audit")
    onClose()
  }
  const tryIt = (e: TimelineEntry) => {
    useStore.setState({ tryRequest: { tool: e.tool, text: e.file ?? e.summary, cwd } })
    setRoute("approver")
    onClose()
  }
  const showDiff = (e: TimelineEntry, ref: string, file?: string) =>
    void send({ type: "checkpoint_preview", cwd, ref }).then((r) => {
      const diff = r.ok ? ((r.data as { diff?: string }).diff ?? "") : ""
      const text = file ? fileSection(diff, file) : diff
      setShown({ seq: e.seq, text: text || (r.ok ? "Nothing has changed since then." : (r.error?.message ?? "It could not be read")) })
    })
  return (
    <section aria-label={`Timeline of ${title}`} className="panel grid gap-3 p-4">
      <div className="flex items-center gap-2">
        <h2 className="m-0 text-[17px]">Timeline</h2>
        <span className="text-[13px] text-mut">Every call, in the order the audit log holds them.</span>
        <button
          type="button"
          className="btn ml-auto !min-h-7"
          onClick={async () => {
            // C-011: signed, with the records it was made from and what both verifiers said of it.
            const day = new Date().toISOString().slice(0, 10)
            const e = await download(`/api/timeline/export?session=${encodeURIComponent(sessionId)}`, `codehouse-timeline-${day}.zip`)
            if (e) return void toast.error(e)
            const k = await api<{ fingerprint: string }>("GET", "/api/timeline/key")
            toast(`Exported, signed with the key ${k.ok && k.data ? k.data.fingerprint : "of this computer"}.`)
          }}
        >
          Export, signed
        </button>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sev">
          {error}
        </p>
      ) : entries === undefined ? (
        <p className="m-0 text-[13.5px] text-mut">Reading the audit log…</p>
      ) : entries.length === 0 ? (
        <p className="m-0 text-[13.5px] text-mut">Nothing has been recorded for this session yet.</p>
      ) : (
        <ol className="m-0 grid list-none gap-1.5 p-0 text-[13px]" aria-label="Calls and events">
          {entries.map((e) => (
            <li key={e.seq} className="grid gap-1 border-b border-line pb-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mono text-mut">{e.records.length > 1 ? `Records ${e.records[0]}-${e.records[e.records.length - 1]}` : `Record ${e.seq}`}</span>
                <span className="mono text-mut">{new Date(e.at).toLocaleTimeString("en-GB")}</span>
                {e.kind === "call" ? (
                  <>
                    <strong>{e.tool}</strong>
                    <span className={e.outcome === "deny" ? "text-sev" : ""}>
                      {decided(e)}, rule {e.ruleId}, risk {e.risk}
                    </span>
                  </>
                ) : (
                  <span>{e.event.replace(/_/g, " ")}</span>
                )}
              </div>
              <span className="mono min-w-0 break-all">{e.summary}</span>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className="btn !min-h-6 !px-2 !text-[12px]" aria-label={`Open record ${e.records[e.records.length - 1]}`} onClick={() => openRecord(e.records[e.records.length - 1]!)}>
                  Open record
                </button>
                {e.kind === "call" ? (
                  <button type="button" className="btn !min-h-6 !px-2 !text-[12px]" onClick={() => tryIt(e)}>
                    Try in policy
                  </button>
                ) : null}
                {e.checkpoint ? (
                  <button type="button" className="btn !min-h-6 !px-2 !text-[12px]" onClick={() => showDiff(e, e.checkpoint!.ref)}>
                    Changes since its checkpoint
                  </button>
                ) : null}
                {e.file && before.get(e.seq) ? (
                  <button type="button" className="btn !min-h-6 !px-2 !text-[12px]" onClick={() => showDiff(e, before.get(e.seq)!, e.file)}>
                    Diff of {e.file.split(/[\\/]/).pop()}
                  </button>
                ) : null}
              </div>
              {shown?.seq === e.seq ? (
                <pre className="mono m-0 max-h-72 overflow-auto rounded bg-s2 p-2 text-[12px]">{shown.text}</pre>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

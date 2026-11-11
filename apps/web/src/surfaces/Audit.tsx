import clsx from "clsx"
import { useCallback, useEffect, useMemo, useState } from "react"
import { TableVirtuoso } from "react-virtuoso"
import { api, download } from "../lib/api"
import { clock } from "../lib/format"
import { useStore } from "../store"
import { RiskBadge } from "../components/RiskBadge"

interface Rec {
  seq: number
  ts: string
  session: string
  event: string
  channel: string
  tool: string
  cwd?: string
  project?: string
  inputJson: string
  verdict: {
    outcome: "allow" | "deny" | "escalate"
    ruleId: string
    reason: string
    risk: number
    decidedBy: string
    segments?: Array<{ text: string }>
  }
  latencyMs: number
  judgeRationale?: string
}

interface Verify {
  ok: boolean
  files: number
  records: number
  problems: Array<{ file: string; line: number; reason: string }>
  moreProblems: number
  /** D-029: the anchors checked with it. */
  anchors?: number
}

/** D-029: one anchor, as the Host keeps it. */
interface Anchor {
  seq: number
  ts: string
  strength: string
  fingerprint: string
}

const AuditTable = (props: React.ComponentProps<"table">) => (
  <table {...props} style={{ ...props.style, width: "100%", borderCollapse: "collapse" }} />
)

const OUTCOME: Record<string, string> = { allow: "Allowed", deny: "Denied", escalate: "Asked you" }
const CHANNEL: Record<string, string> = {
  approver: "Approver",
  host: "Host",
  desktop: "Desktop",
  phone: "Phone",
  timeout: "Timeout",
}

/** The quick views across the top (Stitch, R7): each sets the filter below it. */
const VIEWS: Array<{ id: string; label: string; set: { decision: string; channel: string } }> = [
  { id: "all", label: "All decisions", set: { decision: "", channel: "" } },
  { id: "asked", label: "Asked you", set: { decision: "escalate", channel: "" } },
  { id: "denied", label: "Denied", set: { decision: "deny", channel: "" } },
  { id: "phone", label: "From the phone", set: { decision: "", channel: "phone" } },
]

function summary(r: Rec): string {
  try {
    const i = JSON.parse(r.inputJson) as Record<string, unknown>
    const main = i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.changed
    return typeof main === "string" ? main : JSON.stringify(i)
  } catch {
    return r.inputJson
  }
}

export function Audit() {
  const live = useStore((s) => s.audit) as Rec[]
  const [rows, setRows] = useState<Rec[]>([])
  const [next, setNext] = useState<number>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [selected, setSelected] = useState<Rec>()
  const [verify, setVerify] = useState<Verify>()
  const [f, setF] = useState({ decision: "", channel: "", rule: "", q: "" })
  const [applied, setApplied] = useState(f)

  const query = useCallback((a: typeof f, before?: number) => {
    const p = new URLSearchParams({ limit: "200" })
    for (const [k, v] of Object.entries(a)) if (v.trim()) p.set(k, v.trim())
    if (before !== undefined) p.set("before", String(before))
    return `/api/audit?${p}`
  }, [])

  const load = useCallback(
    async (a: typeof f, more?: number) => {
      setLoading(true)
      setError(undefined)
      const r = await api<{ records: Rec[]; nextBefore?: number }>("GET", query(a, more))
      setLoading(false)
      if (!r.ok || !r.data) {
        setError(r.error ?? "The audit log could not be read")
        return
      }
      const got = r.data.records
      setRows((prev) => (more === undefined ? got : [...prev, ...got]))
      setNext(r.data.nextBefore)
    },
    [query],
  )

  useEffect(() => {
    void load(applied)
  }, [applied, load])

  // D-029: the newest anchor, and one made now on request.
  const [anchor, setAnchor] = useState<Anchor>()
  async function check() {
    setVerify(undefined)
    const r = await api<Verify>("GET", "/api/audit/verify")
    if (r.ok && r.data) setVerify(r.data)
    else setError(r.error ?? "The chain could not be checked")
    const a = await api<{ anchors: Anchor[] }>("GET", "/api/audit/anchors")
    setAnchor(a.ok ? a.data?.anchors[0] : undefined)
  }
  async function anchorNow() {
    const r = await api<{ anchor: Anchor }>("POST", "/api/audit/anchor")
    if (!r.ok) return setError(r.error ?? "The log could not be anchored")
    await check()
  }

  useEffect(() => {
    void check()
  }, [])

  // G31: a record asked for elsewhere (a session's walkthrough) opens here, read by its number.
  const auditOpen = useStore((s) => s.auditOpen)
  useEffect(() => {
    if (auditOpen === undefined) return
    useStore.setState({ auditOpen: undefined })
    void api<{ records: Rec[] }>("GET", `/api/audit?before=${auditOpen + 1}&limit=1`).then((r) => {
      const rec = r.ok ? r.data?.records.find((x) => x.seq === auditOpen) : undefined
      if (rec) setSelected(rec)
      else setError(`Record ${auditOpen} could not be read.`)
    })
  }, [auditOpen])

  // New records stream in at the top only while no filter is applied, so the list never lies about its filter.
  const unfiltered = !Object.values(applied).some((v) => v.trim())
  const merged = useMemo(() => {
    if (!unfiltered) return rows
    const seen = new Set(rows.map((r) => r.seq))
    const fresh = live.filter((r) => !seen.has(r.seq))
    return [...fresh, ...rows].sort((a, b) => b.seq - a.seq)
  }, [rows, live, unfiltered])

  return (
    <div className="grid h-full grid-rows-[auto_auto_auto_1fr]">
      <header className="flex flex-wrap items-center gap-4 px-6 pb-2 pt-5">
        <h1 className="m-0">Audit log</h1>
        <p role="status" className="m-0">
          {verify === undefined ? (
            <span className="text-mut">Checking the chain…</span>
          ) : verify.ok ? (
            <span className="audit-chain">
              <span aria-hidden="true">✓</span>
              Chain intact: {verify.records.toLocaleString("en-GB")} records in {verify.files} file
              {verify.files === 1 ? "" : "s"}
              {verify.anchors ? `, ${verify.anchors} anchor${verify.anchors === 1 ? "" : "s"} matching` : ""}
            </span>
          ) : (
            <span className="font-semibold text-sev">
              Chain broken. First problem: {verify.problems[0]?.file} line{" "}
              {verify.problems[0]?.line}, {verify.problems[0]?.reason}
              {verify.problems.length + verify.moreProblems > 1
                ? ` (and ${verify.problems.length + verify.moreProblems - 1} more)`
                : ""}
            </span>
          )}
        </p>
        <span className="ml-auto" />
        {anchor ? (
          <span className="text-[13px] text-mut">
            Last anchored at record {anchor.seq.toLocaleString("en-GB")}, {new Date(anchor.ts).toLocaleString("en-GB")}
            {anchor.strength === "weaker" ? " (signed on this computer)" : ""}
          </span>
        ) : null}
        <button className="btn" onClick={() => void anchorNow()}>
          Anchor now
        </button>
        <button className="btn" onClick={() => void check()}>
          Check again
        </button>
        <button
          className="btn"
          onClick={async () => {
            // G30: a zip anyone can check, with the verifier and how to run it.
            const day = new Date().toISOString().slice(0, 10)
            const e = await download("/api/audit/bundle", `codehouse-audit-${day}.zip`)
            if (e) setError(e)
          }}
        >
          Export
        </button>
      </header>

      <div role="group" aria-label="Quick views" className="audit-views">
        {VIEWS.map((v) => {
          const on =
            applied.decision === v.set.decision &&
            applied.channel === v.set.channel &&
            !applied.rule.trim() &&
            !applied.q.trim()
          return (
            <button
              key={v.id}
              type="button"
              className="pane-tool"
              aria-pressed={on}
              onClick={() => {
                const next = { decision: v.set.decision, channel: v.set.channel, rule: "", q: "" }
                setF(next)
                setApplied(next)
              }}
            >
              {v.label}
            </button>
          )
        })}
      </div>

      <form
        className="flex flex-wrap items-end gap-3 px-6 pb-3"
        aria-label="Filter the audit log"
        onSubmit={(e) => {
          e.preventDefault()
          setApplied(f)
        }}
      >
        <label className="grid gap-1">
          <span className="text-xs text-mut">Decision</span>
          <select
            className="field"
            value={f.decision}
            onChange={(e) => setF({ ...f, decision: e.target.value })}
          >
            <option value="">All</option>
            <option value="allow">Allowed</option>
            <option value="deny">Denied</option>
            <option value="escalate">Asked you</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-mut">Channel</span>
          <select
            className="field"
            value={f.channel}
            onChange={(e) => setF({ ...f, channel: e.target.value })}
          >
            <option value="">All</option>
            {Object.entries(CHANNEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-mut">Rule id contains</span>
          <input
            className="field mono w-48"
            value={f.rule}
            onChange={(e) => setF({ ...f, rule: e.target.value })}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-mut">Search command, path or reason</span>
          <input
            className="field w-72"
            value={f.q}
            onChange={(e) => setF({ ...f, q: e.target.value })}
          />
        </label>
        <button className="btn btn-primary">Apply</button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const empty = { decision: "", channel: "", rule: "", q: "" }
            setF(empty)
            setApplied(empty)
          }}
        >
          Clear
        </button>
        {error ? (
          <p role="alert" className="m-0 font-semibold text-sev">
            {error}
          </p>
        ) : null}
      </form>

      <div className="grid min-h-0 grid-cols-[1fr_380px] border-t border-line max-[1100px]:grid-cols-1">
        <div className="min-h-0">
          {merged.length === 0 && !loading ? (
            <p className="p-6 text-mut">No records match.</p>
          ) : (
            <TableVirtuoso
              style={{ height: "100%" }}
              data={merged}
              components={{ Table: AuditTable }}
              computeItemKey={(_, r) => r.seq}
              endReached={() => next !== undefined && !loading && void load(applied, next)}
              fixedHeaderContent={() => (
                <tr className="audit-head">
                  <th className="px-3 py-1.5">Risk and decision</th>
                  <th className="px-3 py-1.5">Time</th>
                  <th className="px-3 py-1.5">Channel</th>
                  <th className="px-3 py-1.5">Rule</th>
                  <th className="px-3 py-1.5">Tool</th>
                  <th className="w-full px-3 py-1.5">What</th>
                </tr>
              )}
              itemContent={(_, r) => (
                <>
                  <td className="audit-cell whitespace-nowrap" data-outcome={r.verdict.outcome}>
                    <span className="flex items-center gap-2">
                      <RiskBadge risk={r.verdict.risk} className="!text-[11px]" />
                      <span className="font-semibold">{OUTCOME[r.verdict.outcome]}</span>
                    </span>
                  </td>
                  <td className="audit-cell mono whitespace-nowrap text-mut">{clock(r.ts)}</td>
                  <td className="audit-cell">{CHANNEL[r.channel] ?? r.channel}</td>
                  <td className="audit-cell mono whitespace-nowrap text-[12px]">
                    {r.verdict.ruleId}
                  </td>
                  <td className="audit-cell">{r.tool}</td>
                  <td className="audit-cell max-w-0">
                    <button
                      className={clsx(
                        "mono block w-full truncate border-0 bg-transparent p-0 text-left underline decoration-line underline-offset-2",
                        selected?.seq === r.seq && "font-semibold",
                      )}
                      aria-pressed={selected?.seq === r.seq}
                      onClick={() => setSelected(r)}
                    >
                      {summary(r) || "(nothing)"}
                    </button>
                  </td>
                </>
              )}
            />
          )}
        </div>
        <aside
          aria-label="Decision detail"
          className="overflow-auto border-l border-line bg-s1 p-4 max-[1100px]:border-l-0 max-[1100px]:border-t"
        >
          {selected ? (
            <Detail r={selected} />
          ) : (
            <p className="m-0 text-mut">Pick a row to see why it was decided that way.</p>
          )}
        </aside>
      </div>
    </div>
  )
}

function Detail({ r }: { r: Rec }) {
  let input = r.inputJson
  try {
    input = JSON.stringify(JSON.parse(r.inputJson), null, 2)
  } catch {
    /* keep the raw text */
  }
  return (
    <div className="grid gap-3">
      <h2 className="m-0 text-sm font-semibold">
        {OUTCOME[r.verdict.outcome]} by {CHANNEL[r.channel] ?? r.channel}, record {r.seq}
      </h2>
      <RiskBadge risk={r.verdict.risk} className="justify-self-start" />
      <dl className="m-0 grid grid-cols-[80px_1fr] gap-x-3 gap-y-1">
        <dt className="text-mut">When</dt>
        <dd className="m-0">{new Date(r.ts).toLocaleString("en-GB")}</dd>
        <dt className="text-mut">Rule</dt>
        <dd className="m-0 mono">{r.verdict.ruleId}</dd>
        <dt className="text-mut">Why</dt>
        <dd className="m-0">{r.verdict.reason}</dd>
        <dt className="text-mut">Decided by</dt>
        <dd className="m-0">{r.verdict.decidedBy}</dd>
        <dt className="text-mut">Project</dt>
        <dd className="m-0 [overflow-wrap:anywhere]">{r.project ?? "none"}</dd>
        <dt className="text-mut">Where</dt>
        <dd className="m-0 mono [overflow-wrap:anywhere]">{r.cwd ?? "none"}</dd>
        {r.judgeRationale ? (
          <>
            <dt className="text-mut">Judge</dt>
            <dd className="m-0">{r.judgeRationale}</dd>
          </>
        ) : null}
        <dt className="text-mut">Took</dt>
        <dd className="m-0">{r.latencyMs} ms</dd>
      </dl>
      <div>
        <p className="m-0 mb-1 text-xs text-mut">Input as recorded (already redacted)</p>
        <pre className="cmd max-h-80 overflow-auto text-xs">{input}</pre>
      </div>
    </div>
  )
}

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

  async function check() {
    setVerify(undefined)
    const r = await api<Verify>("GET", "/api/audit/verify")
    if (r.ok && r.data) setVerify(r.data)
    else setError(r.error ?? "The chain could not be checked")
  }

  useEffect(() => {
    void check()
  }, [])

  // New records stream in at the top only while no filter is applied, so the list never lies about its filter.
  const unfiltered = !Object.values(applied).some((v) => v.trim())
  const merged = useMemo(() => {
    if (!unfiltered) return rows
    const seen = new Set(rows.map((r) => r.seq))
    const fresh = live.filter((r) => !seen.has(r.seq))
    return [...fresh, ...rows].sort((a, b) => b.seq - a.seq)
  }, [rows, live, unfiltered])

  return (
    <div className="grid h-full grid-rows-[auto_auto_1fr]">
      <header className="flex flex-wrap items-baseline gap-4 px-6 pb-2 pt-5">
        <h1 className="m-0 text-[22px] font-semibold">Audit log</h1>
        <p role="status" className="m-0">
          {verify === undefined ? (
            <span className="text-mut">Checking the chain…</span>
          ) : verify.ok ? (
            <span className="font-semibold text-ok">
              Chain intact: {verify.records.toLocaleString("en-GB")} records in {verify.files} file
              {verify.files === 1 ? "" : "s"}
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
        <button className="btn" onClick={() => void check()}>
          Check again
        </button>
        <button
          className="btn"
          onClick={async () => {
            const e = await download("/api/audit/export", "gatehouse-audit.jsonl")
            if (e) setError(e)
          }}
        >
          Export
        </button>
      </header>

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
                <tr className="bg-s1 text-left text-xs uppercase tracking-wide text-mut">
                  <th className="px-3 py-1.5 font-semibold">Time</th>
                  <th className="px-3 py-1.5 font-semibold">Decision</th>
                  <th className="px-3 py-1.5 font-semibold">Channel</th>
                  <th className="px-3 py-1.5 font-semibold">Tool</th>
                  <th className="w-full px-3 py-1.5 font-semibold">What</th>
                </tr>
              )}
              itemContent={(_, r) => (
                <>
                  <td className="whitespace-nowrap px-3 py-1 align-top text-mut">{clock(r.ts)}</td>
                  <td className="whitespace-nowrap px-3 py-1 align-top font-semibold">
                    {OUTCOME[r.verdict.outcome]}
                  </td>
                  <td className="px-3 py-1 align-top">{CHANNEL[r.channel] ?? r.channel}</td>
                  <td className="px-3 py-1 align-top">{r.tool}</td>
                  <td className="max-w-0 px-3 py-1 align-top">
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

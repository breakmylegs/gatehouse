import clsx from "clsx"
import { Library } from "./Library"
import { diffLines } from "diff"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { Insights } from "./Insights"
import { PolicyChoices } from "./PolicyChoices"

interface RuleLike {
  id: string
  reason?: string
  tools?: string[]
  commands?: string[]
  pathGlobs?: string[]
  pathInside?: string
  pathOutside?: string
  [k: string]: unknown
}
interface PolicyData {
  status: { hash?: string; errors: string[]; overlays: string[]; loadedAt?: string }
  rulesPath: string
  rulesYaml: string
  rulesYamlHash: string
  rules?: {
    floor: RuleLike[]
    deny: RuleLike[]
    escalate: RuleLike[]
    allow: RuleLike[]
    workspaceRoots: string[]
  }
  remember: RuleLike[]
  localYaml: string
}
interface Verdict {
  outcome: string
  ruleId: string
  reason: string
  risk: number
  decidedBy: string
  segments?: Array<{ text: string; ruleId: string; outcome: string }>
}
interface ReplayResult {
  total: number
  capped: boolean
  changes: Array<{
    line: number
    summary: string
    before: { outcome: string; ruleId: string }
    after: { outcome: string; ruleId: string; reason: string }
    outcomeChanged: boolean
  }>
}

type Tab = "rules" | "library" | "test" | "edit" | "remember" | "insights"
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "rules", label: "Rules" },
  { id: "library", label: "Library" },
  { id: "test", label: "Test a command" },
  { id: "edit", label: "Edit and activate" },
  { id: "remember", label: "Remember rules" },
  { id: "insights", label: "Insights" },
]
const SECTIONS = [
  ["floor", "Floor: always blocked, nothing can lift these"],
  ["deny", "Deny: blocked"],
  ["escalate", "Escalate: ask you"],
  ["allow", "Allow: go through"],
] as const

function select(r: RuleLike): string {
  const bits: string[] = []
  if (r.tools) bits.push(`tools ${r.tools.join(", ")}`)
  if (r.commands) bits.push(`commands ${r.commands.join(", ")}`)
  if (r.pathGlobs) bits.push(`paths ${r.pathGlobs.join(", ")}`)
  if (r.pathInside) bits.push("inside the workspace")
  if (r.pathOutside) bits.push("outside the workspace")
  return bits.join(" · ")
}

/**
 * What Claude may do. The plain choices come first; Advanced is the full studio (rules, packs, the rules file,
 * remembered rules, figures), for people who want the mechanics.
 */
export function Policy() {
  const [view, setView] = useState<"choices" | "advanced">("choices")
  return (
    <div className="mx-auto grid max-w-[1100px] gap-5 p-6">
      <header className="grid gap-3">
        <h1 className="m-0">What Claude may do</h1>
        <div role="tablist" aria-label="Policy views" className="flex gap-1 border-b border-line">
          {(
            [
              ["choices", "Your choices"],
              ["advanced", "Advanced"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              id={`view-${id}`}
              aria-selected={view === id}
              aria-controls={`view-panel-${id}`}
              tabIndex={view === id ? 0 : -1}
              className="tab"
              onClick={() => setView(id)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  const next = view === "choices" ? "advanced" : "choices"
                  setView(next)
                  document.getElementById(`view-${next}`)?.focus()
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <div role="tabpanel" id={`view-panel-${view}`} aria-labelledby={`view-${view}`}>
        {view === "choices" ? <PolicyChoices onAdvanced={() => setView("advanced")} /> : <Studio />}
      </div>
    </div>
  )
}

/** The full policy studio. */
function Studio() {
  const [tab, setTab] = useState<Tab>("rules")
  const [data, setData] = useState<PolicyData>()
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    const r = await api<PolicyData>("GET", "/api/policy")
    if (r.ok && r.data) {
      setData(r.data)
      setError(undefined)
    } else setError(r.error ?? "The policy could not be read")
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-baseline gap-4">
        <h2 className="m-0 text-[19px]">Policy studio</h2>
        {data ? (
          <span className="text-mut">
            Live policy <span className="mono">{data.status.hash?.slice(0, 12) ?? "none"}</span>
            {data.status.errors.length ? (
              <strong className="ml-2 text-sev">did not load</strong>
            ) : null}
          </span>
        ) : null}
      </header>
      {error ? (
        <p role="alert" className="m-0 font-semibold text-sev">
          {error}
        </p>
      ) : null}
      {data?.status.errors.length ? (
        <ul role="alert" className="m-0 text-sev">
          {data.status.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      <div
        role="tablist"
        aria-label="Policy studio sections"
        className="flex gap-1 border-b border-line"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className="tab"
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              const i = TABS.findIndex((x) => x.id === tab)
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                const n = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]
                if (n) {
                  setTab(n.id)
                  document.getElementById(`tab-${n.id}`)?.focus()
                }
              }
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {!data ? (
          <p className="text-mut">Loading…</p>
        ) : tab === "rules" ? (
          <Rules data={data} />
        ) : tab === "library" ? (
          <Library />
        ) : tab === "test" ? (
          <TestCommand />
        ) : tab === "insights" ? (
          <Insights />
        ) : tab === "edit" ? (
          <Edit data={data} onActivated={load} />
        ) : (
          <Remember data={data} onChanged={load} />
        )}
      </div>
    </div>
  )
}

function Rules({ data }: { data: PolicyData }) {
  const rules = data.rules
  if (!rules) return <p className="text-mut">No policy is loaded.</p>
  return (
    <div className="grid gap-5">
      <p className="m-0 text-mut">
        Workspace roots: <span className="mono">{rules.workspaceRoots.join(", ") || "none"}</span>.
        Rules file: <span className="mono">{data.rulesPath}</span>
      </p>
      {SECTIONS.map(([key, title]) => (
        <section key={key} aria-label={title}>
          <h2 className="m-0 mb-1 text-sm font-semibold">
            {title} ({rules[key].length})
          </h2>
          <ul className="m-0 list-none divide-y divide-line border-y border-line p-0">
            {rules[key].map((r) => (
              <li
                key={r.id}
                className="grid grid-cols-[210px_1fr] gap-3 py-1.5 max-[800px]:grid-cols-1"
              >
                <span className="mono font-semibold">{r.id}</span>
                <span>
                  {r.reason ? <span className="block">{r.reason}</span> : null}
                  <span className="mono block text-xs text-mut [overflow-wrap:anywhere]">
                    {select(r)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function TestCommand() {
  const [tool, setTool] = useState("Bash")
  const [text, setText] = useState("git status")
  const [cwd, setCwd] = useState("C:\\dev")
  const [verdict, setVerdict] = useState<Verdict>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const shell = tool === "Bash" || tool === "PowerShell"

  async function run(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    let input: Record<string, unknown>
    if (shell) input = { command: text }
    else {
      try {
        input = JSON.parse(text) as Record<string, unknown>
      } catch {
        setBusy(false)
        setError("For this tool the input must be valid JSON.")
        return
      }
    }
    const r = await api<Verdict>("POST", "/api/policy/test", { toolName: tool, input, cwd })
    setBusy(false)
    if (r.ok && r.data) setVerdict(r.data)
    else setError(r.error ?? "The test failed")
  }

  return (
    <form onSubmit={run} className="grid gap-3" aria-label="Test a command">
      <p className="m-0 text-mut">
        Runs the live policy on what you type. Nothing runs and nothing is written to the audit log.
      </p>
      <div className="grid grid-cols-[160px_1fr] gap-3 max-[800px]:grid-cols-1">
        <label className="grid gap-1">
          <span>Tool</span>
          <select
            className="field"
            value={tool}
            onChange={(e) => {
              setTool(e.target.value)
              setText(
                e.target.value === "Bash" || e.target.value === "PowerShell"
                  ? ""
                  : '{ "file_path": "C:\\\\dev\\\\notes.txt" }',
              )
            }}
          >
            {["Bash", "PowerShell", "Read", "Write", "Edit", "Glob", "Grep"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span>Working folder</span>
          <input
            className="field mono"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            required
          />
        </label>
      </div>
      <label className="grid gap-1">
        <span>{shell ? "Command" : "Tool input (JSON)"}</span>
        <textarea
          className="field mono"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
      </label>
      <div>
        <button className="btn btn-primary" disabled={busy || !text.trim()}>
          {busy ? "Testing…" : "Test"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="m-0 font-semibold text-sev">
          {error}
        </p>
      ) : null}
      {verdict ? (
        <section aria-label="Result" className="panel grid gap-2 p-4" role="status">
          <h2 className="m-0 text-[18px]">
            {verdict.outcome === "allow"
              ? "Allowed"
              : verdict.outcome === "deny"
                ? "Denied"
                : "Would ask you"}
            <span className="ml-3 text-sm font-normal text-mut">risk {verdict.risk}</span>
          </h2>
          <p className="m-0">
            <span className="mono font-semibold">{verdict.ruleId}</span>: {verdict.reason}
          </p>
          {verdict.segments?.length ? (
            <ul className="m-0 list-none p-0">
              {verdict.segments.map((s, i) => (
                <li key={i} className="grid grid-cols-[110px_1fr] gap-3">
                  <span className="mono text-xs text-mut">
                    {s.outcome}, {s.ruleId}
                  </span>
                  <span className="mono [overflow-wrap:anywhere]">{s.text}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </form>
  )
}

function Edit({ data, onActivated }: { data: PolicyData; onActivated: () => Promise<void> }) {
  const [yaml, setYaml] = useState(data.rulesYaml)
  const [replay, setReplay] = useState<ReplayResult>()
  const [errors, setErrors] = useState<string[]>()
  const [busy, setBusy] = useState(false)
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => {
    setYaml(data.rulesYaml)
    setReplay(undefined)
    setReviewing(false)
  }, [data.rulesYamlHash, data.rulesYaml])

  const dirty = yaml !== data.rulesYaml
  const parts = useMemo(
    () => (reviewing ? diffLines(data.rulesYaml, yaml) : []),
    [reviewing, data.rulesYaml, yaml],
  )

  async function runReplay() {
    setBusy(true)
    setErrors(undefined)
    const r = await api<ReplayResult>("POST", "/api/policy/replay", { rulesYaml: yaml })
    setBusy(false)
    if (r.ok && r.data) setReplay(r.data)
    else setErrors(r.errors ?? [r.error ?? "The replay failed"])
  }

  async function activate() {
    setBusy(true)
    setErrors(undefined)
    const r = await api<{ hash: string }>("PUT", "/api/policy/rules", {
      yaml,
      baseHash: data.rulesYamlHash,
    })
    setBusy(false)
    if (!r.ok) {
      setErrors(r.errors ?? [r.error ?? "The rules were not saved"])
      return
    }
    toast("New rules are live")
    setReviewing(false)
    await onActivated()
  }

  return (
    <div className="grid gap-3">
      <p className="m-0 text-mut">
        Edit the rules file, replay your change against past decisions, review the diff, then
        activate. A file that does not load is never saved.
      </p>
      <label className="grid gap-1">
        <span>Rules (YAML)</span>
        <textarea
          className="field mono"
          rows={18}
          value={yaml}
          onChange={(e) => {
            setYaml(e.target.value)
            setReplay(undefined)
            setReviewing(false)
          }}
          spellCheck={false}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={busy || !dirty} onClick={() => void runReplay()}>
          Replay against the audit log
        </button>
        <button className="btn" disabled={busy || !dirty} onClick={() => setReviewing(true)}>
          Review diff
        </button>
        <button className="btn" disabled={!dirty} onClick={() => setYaml(data.rulesYaml)}>
          Discard changes
        </button>
      </div>
      {errors?.length ? (
        <ul role="alert" className="m-0 font-semibold text-sev">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {replay ? (
        <section aria-label="Replay result" className="panel p-4">
          <h2 className="m-0 text-sm font-semibold">
            {replay.changes.length === 0
              ? `No decision would change across ${replay.total.toLocaleString("en-GB")} past calls.`
              : `${replay.changes.length} of ${replay.total.toLocaleString("en-GB")} past decisions would change.`}
            {replay.capped ? " Only the most recent calls were replayed." : ""}
          </h2>
          {replay.changes.length > 0 ? (
            <ul className="m-0 mt-2 grid list-none gap-1.5 p-0">
              {replay.changes.slice(0, 100).map((c) => (
                <li key={c.line} className="grid grid-cols-[1fr_auto] gap-3">
                  <span className="mono [overflow-wrap:anywhere]">{c.summary}</span>
                  <span>
                    {c.before.outcome} to <strong>{c.after.outcome}</strong> ({c.after.ruleId})
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {reviewing ? (
        <section aria-label="Diff" className="panel p-0">
          <pre className="cmd max-h-96 overflow-auto !border-0 !p-0">
            {parts.flatMap((p, i) =>
              p.value
                .replace(/\n$/, "")
                .split("\n")
                .map((line, j) => (
                  <div
                    key={`${i}-${j}`}
                    className={clsx(
                      "px-3",
                      p.added && "bg-hi font-semibold",
                      p.removed && "text-sev line-through",
                    )}
                  >
                    <span aria-hidden="true" className="mr-2 inline-block w-3 select-none">
                      {p.added ? "+" : p.removed ? "-" : " "}
                    </span>
                    <span className="sr-only">
                      {p.added ? "Added: " : p.removed ? "Removed: " : "Unchanged: "}
                    </span>
                    {line}
                  </div>
                )),
            )}
          </pre>
          <div className="flex gap-2 border-t border-line p-3">
            <button className="btn btn-primary" disabled={busy} onClick={() => void activate()}>
              Activate these rules
            </button>
            <button className="btn" onClick={() => setReviewing(false)}>
              Close diff
            </button>
          </div>
        </section>
      ) : null}
    </div>
  )
}

function Remember({ data, onChanged }: { data: PolicyData; onChanged: () => Promise<void> }) {
  const [error, setError] = useState<string>()
  async function remove(id: string) {
    const r = await api("POST", "/api/policy/remember/remove", { id })
    if (!r.ok) setError(r.error ?? "Could not remove it")
    else {
      setError(undefined)
      toast("Rule removed")
      await onChanged()
    }
  }
  return (
    <div className="grid gap-3">
      <p className="m-0 text-mut">
        Each rule here was created when you chose Remember on an approval. It allows exactly one
        command or one file, and nothing else. Remove any you no longer want.
      </p>
      {error ? (
        <p role="alert" className="m-0 font-semibold text-sev">
          {error}
        </p>
      ) : null}
      {data.remember.length === 0 ? (
        <p className="m-0">No remembered decisions yet.</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-line border-y border-line p-0">
          {data.remember.map((r) => (
            <li key={r.id} className="grid grid-cols-[1fr_auto] items-center gap-3 py-2">
              <span>
                <span className="mono block text-xs text-mut">{r.id}</span>
                <span className="mono [overflow-wrap:anywhere]">
                  {(r.tools ?? []).join(", ")}:{" "}
                  {(r.commands ?? [])[0] ?? (r.paths as string[] | undefined)?.[0] ?? ""}
                </span>
              </span>
              <button className="btn btn-deny" onClick={() => void remove(r.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

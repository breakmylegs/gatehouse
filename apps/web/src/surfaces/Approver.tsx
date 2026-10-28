import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { RiskBadge } from "../components/RiskBadge"
import { api } from "../lib/api"
import { useStore } from "../store"

interface ApproverInfo {
  state: string
  supervised: boolean
  policy: { hash: string | null; errors: string[]; overlays: string[]; remembered: number }
  pwsh: { running: boolean; languageMode: string | null }
  tools: Array<{ name: string; purpose: string }>
  recent: Array<{
    seq: number
    ts: string
    tool: string
    project: string | null
    outcome: string
    ruleId: string
    reason: string
    risk: number
    latencyMs: number
  }>
}

interface TestVerdict {
  outcome: string
  ruleId: string
  reason: string
  risk: number
}

const OUTCOME: Record<string, string> = { allow: "Allowed", deny: "Denied", escalate: "Asked you" }

/**
 * The Approver workbench: the MCP server that decides, what state it is in, what it offers, a dry run through it, and
 * what it decided lately. A restart goes through the supervisor.
 */
export function Approver() {
  const health = useStore((s) => s.health)
  const [info, setInfo] = useState<ApproverInfo>()
  const [error, setError] = useState<string>()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await api<ApproverInfo>("GET", "/api/approver")
    if (r.ok && r.data) {
      setInfo(r.data)
      setError(undefined)
    } else setError(r.error ?? "The Approver's status could not be read")
  }, [])
  useEffect(() => {
    void load()
  }, [load, health?.approver.state])

  async function restart() {
    setBusy(true)
    const r = await api<{ state: string }>("POST", "/api/approver/restart")
    setBusy(false)
    setConfirm(false)
    if (!r.ok) {
      toast.error(r.error ?? "The Approver did not restart")
      return
    }
    toast("The Approver restarted")
    await load()
  }

  if (error)
    return (
      <p role="alert" className="p-6 font-semibold text-sev">
        {error}
      </p>
    )
  if (!info) return <p className="p-6 text-mut">Loading…</p>
  const up = info.state === "up"

  return (
    <div className="mx-auto grid max-w-[1040px] gap-6 p-6">
      <header className="grid gap-1">
        <h1 className="m-0">Approver</h1>
        <p className="m-0 max-w-[72ch] text-mut">
          The Approver is the MCP server that decides each permission request with your rules. It
          runs on this computer next to JCVC and answers only JCVC. Anything it cannot be sure about
          is sent to you.
        </p>
      </header>

      <section aria-label="Status" className="pass grid-cols-1!">
        <div className="pass-head rounded-t-[8px]!">
          <span>
            <span className="lbl">State</span>
            <span className={up ? "val text-ok" : "val text-sev"}>
              {up ? "Running" : info.state === "starting" ? "Starting" : "Not running"}
            </span>
          </span>
          <span className="min-w-0">
            <span className="lbl">Policy</span>
            <span className="val mono !text-[14px]">
              {info.policy.hash ? info.policy.hash.slice(0, 12) : "not loaded"}
            </span>
          </span>
          <span>
            <span className="lbl">Remembered rules</span>
            <span className="val">{info.policy.remembered}</span>
          </span>
          <span>
            <span className="lbl">PowerShell parser</span>
            <span className="val">
              {info.pwsh.running
                ? `Running${info.pwsh.languageMode ? `, ${info.pwsh.languageMode}` : ""}`
                : "Not running"}
            </span>
          </span>
        </div>
        <div className="grid gap-3 p-5">
          {info.policy.errors.length ? (
            <div role="alert" className="text-sev">
              <strong>The rules have problems:</strong>
              <ul className="m-0 mt-1 pl-5">
                {info.policy.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="m-0">The rules loaded with no problems.</p>
          )}
          {!info.pwsh.running ? (
            <p className="m-0 text-mut">
              Without the PowerShell parser, every PowerShell command waits for you.
            </p>
          ) : null}
          {info.supervised ? (
            confirm ? (
              <div
                role="group"
                aria-label="Confirm the restart"
                className="flex flex-wrap items-center gap-2"
              >
                <span>
                  Restart the Approver? Requests made while it restarts wait for you; nothing is
                  allowed without it.
                </span>
                <button className="btn btn-primary" disabled={busy} onClick={() => void restart()}>
                  {busy ? "Restarting…" : "Yes, restart"}
                </button>
                <button className="btn" onClick={() => setConfirm(false)} autoFocus>
                  Cancel
                </button>
              </div>
            ) : (
              <div>
                <button className="btn" onClick={() => setConfirm(true)}>
                  Restart the Approver
                </button>
              </div>
            )
          ) : (
            <p className="m-0 text-mut">
              This Approver is not run by JCVC, so it is restarted elsewhere.
            </p>
          )}
        </div>
      </section>

      <TryIt />

      <section aria-label="What it offers" className="grid gap-2">
        <h2 className="m-0 text-[19px]">What it offers</h2>
        <p className="m-0 text-mut">The tools the Approver answers over MCP.</p>
        <table className="panel w-full border-separate border-spacing-0 overflow-hidden text-left">
          <caption className="sr-only">The Approver's tools</caption>
          <tbody>
            {info.tools.map((t) => (
              <tr key={t.name}>
                <th
                  scope="row"
                  className="mono w-[220px] border-b border-line px-4 py-2.5 align-top text-[13px] font-normal"
                >
                  {t.name}
                </th>
                <td className="border-b border-line px-4 py-2.5">{t.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="Recent decisions" className="grid gap-2">
        <h2 className="m-0 text-[19px]">What it decided lately</h2>
        {info.recent.length === 0 ? (
          <p className="m-0 text-mut">No decisions yet. They appear here as sessions run.</p>
        ) : (
          <table className="panel w-full border-separate border-spacing-0 overflow-hidden text-left">
            <caption className="sr-only">The Approver's last decisions, newest first</caption>
            <thead>
              <tr className="sign text-[12.5px] font-medium text-mut">
                <th className="border-b border-line px-4 py-2 font-medium">Time</th>
                <th className="border-b border-line px-4 py-2 font-medium">Tool</th>
                <th className="border-b border-line px-4 py-2 font-medium">Decision</th>
                <th className="border-b border-line px-4 py-2 font-medium">Rule and reason</th>
                <th className="border-b border-line px-4 py-2 text-right font-medium">Took</th>
              </tr>
            </thead>
            <tbody>
              {info.recent.map((r) => (
                <tr key={r.seq}>
                  <td className="sign border-b border-line px-4 py-2 align-top">
                    {new Date(r.ts).toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="border-b border-line px-4 py-2 align-top">
                    {r.tool}
                    {r.project ? <span className="block text-xs text-mut">{r.project}</span> : null}
                  </td>
                  <td className="sign border-b border-line px-4 py-2 align-top font-medium">
                    {OUTCOME[r.outcome] ?? r.outcome}
                  </td>
                  <td className="border-b border-line px-4 py-2 align-top">
                    <span className="mono block text-[13px]">{r.ruleId}</span>
                    <span className="block text-[13px] text-mut">{r.reason}</span>
                  </td>
                  <td className="sign border-b border-line px-4 py-2 text-right align-top">
                    {r.latencyMs} ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

/** Run a request through the live policy without running anything or writing to the audit log. */
function TryIt() {
  const [tool, setTool] = useState("Bash")
  const [text, setText] = useState("npm install left-pad")
  const [cwd, setCwd] = useState("C:\\dev\\my-project")
  const [verdict, setVerdict] = useState<TestVerdict>()
  const [error, setError] = useState<string>()

  async function run(e: React.FormEvent) {
    e.preventDefault()
    setError(undefined)
    setVerdict(undefined)
    const input =
      tool === "Bash" || tool === "PowerShell"
        ? { command: text }
        : tool === "Read" || tool === "Edit" || tool === "Write"
          ? { file_path: text }
          : tool === "WebFetch"
            ? { url: text }
            : { value: text }
    const r = await api<TestVerdict>("POST", "/api/policy/test", { toolName: tool, input, cwd })
    if (r.ok && r.data) setVerdict(r.data)
    else setError(r.error ?? "The test did not run")
  }

  return (
    <form onSubmit={run} className="panel grid gap-3 p-5" aria-label="Try a request">
      <div>
        <h2 className="m-0 text-[19px]">Try a request</h2>
        <p className="m-0 text-mut">
          See what the Approver would decide and why. Nothing runs and nothing is written to the
          audit log.
        </p>
      </div>
      <div className="grid grid-cols-[160px_minmax(0,1fr)] gap-3 max-[700px]:grid-cols-1">
        <label className="grid gap-1">
          <span>Tool</span>
          <select className="field" value={tool} onChange={(e) => setTool(e.target.value)}>
            {["Bash", "PowerShell", "Read", "Edit", "Write", "WebFetch"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span>
            {tool === "Bash" || tool === "PowerShell"
              ? "Command"
              : tool === "WebFetch"
                ? "Address"
                : "File"}
          </span>
          <input className="field mono" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      </div>
      <label className="grid gap-1">
        <span>In folder</span>
        <input className="field mono" value={cwd} onChange={(e) => setCwd(e.target.value)} />
      </label>
      <div>
        <button className="btn btn-primary" disabled={!text.trim() || !cwd.trim()}>
          Try it
        </button>
      </div>
      {error ? (
        <p role="alert" className="m-0 font-semibold text-sev">
          {error}
        </p>
      ) : null}
      {verdict ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded bg-s2 px-4 py-3"
        >
          <span>
            <span className="lbl">Decision</span>
            <span className="val">{OUTCOME[verdict.outcome] ?? verdict.outcome}</span>
          </span>
          <span>
            <span className="lbl">Rule</span>
            <span className="val mono !text-[14px]">{verdict.ruleId}</span>
          </span>
          <RiskBadge risk={verdict.risk} className="text-sm" />
          <span className="basis-full">{verdict.reason}</span>
        </div>
      ) : null}
    </form>
  )
}

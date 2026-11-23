import { useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Op {
  method: string
  path: string
  status?: number
  ok: boolean
  mismatches: string[]
  skipped?: string
}
interface Mocks {
  operations: number
  msw: string
  wiremock: string
  prism: string
}
interface Report {
  base: string
  operations: Op[]
  mismatches: string[]
  refused?: string
  /** E-034: how answers changed shape since the last probe. */
  changes?: string[]
  /** E-037: error answers that break RFC 9457 or the project's convention. */
  errors?: string[]
}

/** E-031: each operation of an OpenAPI spec sent to the app on this computer, its answers checked against the spec. */
export function ContractProbePanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [spec, setSpec] = useState("openapi.yaml")
  const [base, setBase] = useState("")
  const [r, setR] = useState<Report>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [mocks, setMocks] = useState<Mocks>()
  const [drift, setDrift] = useState<Array<{ tool: string; output: string; drift?: { added: string[]; gone: string[]; changed: string[] }; notChecked?: string }>>()
  async function checkClients() {
    setBusy(true)
    const x = await send({ type: "client_drift", sessionId })
    setBusy(false)
    if (x.ok) setDrift((x.data as { results: NonNullable<typeof drift> }).results)
    else setError(x.error?.message ?? "The clients could not be checked")
  }
  const [lint, setLint] = useState<Array<{ rule: string; where: string; message: string }>>()
  async function checkSpec() {
    const x = await send({ type: "api_lint", sessionId, spec: spec.trim() })
    if (x.ok) setLint((x.data as { findings: Array<{ rule: string; where: string; message: string }> }).findings)
    else setError(x.error?.message ?? "The spec could not be checked")
  }
  async function makeMocks() {
    const x = await send({ type: "mock_defs", sessionId, spec: spec.trim() })
    if (x.ok) setMocks(x.data as Mocks)
    else setError(x.error?.message ?? "No mocks were made")
  }
  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast("Copied", { id: "mocks" }))
  async function go() {
    setBusy(true)
    setError(undefined)
    const x = await send({ type: "contract_probe", sessionId, spec: spec.trim(), ...(base.trim() ? { base: base.trim() } : {}) })
    setBusy(false)
    if (x.ok) setR(x.data as Report)
    else setError(x.error?.message ?? "The probe did not run")
  }
  return (
    <section aria-label="API contract" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">API contract</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="text-xs text-mut">OpenAPI spec in the project</span>
          <input className="field mono" value={spec} onChange={(e) => setSpec(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-mut">App address (empty: the spec&apos;s server)</span>
          <input className="field mono" value={base} placeholder="http://127.0.0.1:3000" onChange={(e) => setBase(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary !min-h-7" disabled={busy || !spec.trim()} onClick={() => void go()}>
          {busy ? "Probing…" : "Probe"}
        </button>
        <button type="button" className="btn !min-h-7" disabled={!spec.trim()} onClick={() => void makeMocks()}>
          Make mocks
        </button>
        <button type="button" className="btn !min-h-7" disabled={!spec.trim()} onClick={() => void checkSpec()}>
          Check the spec
        </button>
        <button type="button" className="btn !min-h-7" disabled={busy} onClick={() => void checkClients()}>
          Check generated clients
        </button>
      </div>
      <p className="m-0 text-xs text-mut">
        Only an app on this computer is probed. Each request is judged by your rules first, as the same curl command from
        the session would be. Mismatches go into the evidence pack and make claims of done Contradicted until a probe passes.
      </p>
      {error ? <p className="m-0">{error}</p> : null}
      {drift ? (
        <div className="grid gap-1">
          {/* E-036: each generated client against a fresh generation with the project's own tool. */}
          {!drift.length ? <span className="text-mut">No orval, openapi-generator, NSwag or Kiota config found.</span> : null}
          {drift.map((d) => (
            <span key={`${d.tool} ${d.output}`}>
              <span className="mono">{d.output}</span> ({d.tool}):{" "}
              {d.notChecked
                ? `not checked: ${d.notChecked}`
                : d.drift && d.drift.added.length + d.drift.gone.length + d.drift.changed.length
                  ? `out of date with its spec: ${[...d.drift.changed.map((f) => `${f} changed`), ...d.drift.added.map((f) => `${f} new`), ...d.drift.gone.map((f) => `${f} gone`)].slice(0, 8).join(", ")}`
                  : "matches a fresh generation"}
            </span>
          ))}
        </div>
      ) : null}
      {lint ? (
        <div className="grid gap-1">
          {/* E-035: API security gaps in the spec. */}
          <strong>{lint.length ? `Gaps in the spec (${lint.length})` : "No security or error contract gaps found in the spec"}</strong>
          {lint.map((f) => (
            <span key={`${f.rule} ${f.where} ${f.message}`}>
              <span className="mono">{f.where}</span>: {f.message}
            </span>
          ))}
        </div>
      ) : null}
      {mocks ? (
        <div className="grid gap-1">
          {/* E-032: mocks for the project's own tools, to copy; Codehouse hosts no mock server. */}
          <p className="m-0 text-mut">Mocks for {mocks.operations} operation(s), each answering its first success response.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn !min-h-7" onClick={() => copy(mocks.msw)}>
              Copy MSW handlers
            </button>
            <button type="button" className="btn !min-h-7" onClick={() => copy(mocks.wiremock)}>
              Copy WireMock mappings
            </button>
            <button type="button" className="btn !min-h-7" onClick={() => copy(mocks.prism)}>
              Copy the Prism command
            </button>
          </div>
          <pre className="mono m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words">{mocks.msw}</pre>
        </div>
      ) : null}
      {r?.refused ? <p className="m-0">{r.refused}</p> : null}
      {r && !r.refused ? (
        <>
          <p className="m-0 text-mut">
            {r.operations.length} operation(s) on {r.base}: {r.mismatches.length ? `${r.mismatches.length} mismatch(es)` : "every answer matches the spec"}.
          </p>
          {r.errors?.length ? (
            <div className="grid gap-0.5">
              <strong>Error answers that break the error contract</strong>
              {r.errors.map((e) => (
                <span key={e} className="break-words text-mut">
                  {e}
                </span>
              ))}
            </div>
          ) : null}
          {r.changes?.length ? (
            <div className="grid gap-0.5">
              <strong>Changed since the last probe</strong>
              {r.changes.map((c) => (
                <span key={c} className="mono break-words text-mut">
                  {c}
                </span>
              ))}
            </div>
          ) : null}
          <ul className="m-0 grid list-none gap-1 p-0">
            {r.operations.map((o) => (
              <li key={`${o.method} ${o.path}`} className="grid gap-0.5">
                <span>
                  <span className="mono">
                    {o.method} {o.path}
                  </span>
                  {o.skipped ? `: not sent (${o.skipped})` : o.ok ? `: ${o.status}, matches` : o.status !== undefined ? `: ${o.status}` : ""}
                </span>
                {o.mismatches.map((m) => (
                  <span key={m} className="text-mut">
                    {m}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

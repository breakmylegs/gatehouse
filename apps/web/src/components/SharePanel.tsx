import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api, download } from "../lib/api"

interface Plan {
  project: string
  files: number
  bytes: number
  left: Array<{ file: string; why: string }>
  publishers: string[]
}

const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

/**
 * G40 (owner's connector items, 9 Nov): share the project as a zip that leaves out what could be secret (named here
 * before you make it), and publish it with a public host's own tool named in Settings. Both are your actions, audited.
 */
export function SharePanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [plan, setPlan] = useState<Plan>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [result, setResult] = useState<{ name: string; exitCode: number | null; timedOut: boolean; output: string }>()

  useEffect(() => {
    void api<Plan>("GET", `/api/share/plan?session=${encodeURIComponent(sessionId)}`).then((r) => (r.ok && r.data ? setPlan(r.data) : setError(r.error ?? "The project could not be read.")))
  }, [sessionId])

  const zip = async () => {
    if (!plan) return
    setBusy("zip")
    const e = await download(`/api/share/zip?session=${encodeURIComponent(sessionId)}`, `${plan.project}.zip`)
    setBusy(undefined)
    if (e) toast.error(e, { id: "share" })
    else toast(`${plan.project}.zip is in your downloads.`, { id: "share" })
  }
  const publish = async (name: string) => {
    setBusy(name)
    setResult(undefined)
    const r = await api<{ exitCode: number | null; timedOut: boolean; output: string }>("POST", "/api/share/publish", { session: sessionId, name })
    setBusy(undefined)
    if (!r.ok || !r.data) return void toast.error(r.error ?? "It could not be published.", { id: "share" })
    setResult({ name, ...r.data })
  }

  return (
    <section aria-label="Share and publish" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-[15px]">Share and publish</h2>
        <button type="button" className="btn ml-auto !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sev">
          {error}
        </p>
      ) : !plan ? (
        <p className="m-0 text-mut">Looking at the project…</p>
      ) : (
        <>
          <p className="m-0">
            A zip of {plan.project}: {plan.files} file{plan.files === 1 ? "" : "s"}, {size(plan.bytes)}. What git ignores stays out.
          </p>
          {plan.left.length ? (
            <div>
              <h3 className="m-0 text-[13px]">Left out, so nothing secret is shared</h3>
              <ul className="m-0 grid list-none gap-0.5 p-0" aria-label="Left out">
                {plan.left.slice(0, 50).map((l) => (
                  <li key={l.file}>
                    <span className="mono">{l.file}</span> <span className="text-mut">({l.why})</span>
                  </li>
                ))}
                {plan.left.length > 50 ? <li className="text-mut">and {plan.left.length - 50} more, named in the note inside the zip</li> : null}
              </ul>
            </div>
          ) : (
            <p className="m-0 text-mut">Nothing looked secret, so nothing is left out.</p>
          )}
          <div>
            <button type="button" className="btn btn-primary !min-h-7" disabled={busy !== undefined} onClick={() => void zip()}>
              {busy === "zip" ? "Making the zip…" : "Download the zip"}
            </button>
          </div>
          <h3 className="m-0 text-[13px]">Publish</h3>
          {plan.publishers.length ? (
            <div className="flex flex-wrap gap-2">
              {plan.publishers.map((n) => (
                <button key={n} type="button" className="btn !min-h-7" disabled={busy !== undefined} onClick={() => void publish(n)}>
                  {busy === n ? `Publishing with ${n}…` : `Publish with ${n}`}
                </button>
              ))}
            </div>
          ) : (
            <p className="m-0 text-mut">No host is named. Add its own command in Settings, Connectors, Publish (it signs in its own way).</p>
          )}
          {result ? (
            <div role="status" className="grid gap-1">
              <p className="m-0">
                {result.timedOut ? `${result.name} took too long and was stopped.` : result.exitCode === 0 ? `${result.name} finished.` : `${result.name} ended with code ${result.exitCode ?? "none"}.`}
              </p>
              {result.output.trim() ? <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap text-[12.5px] text-mut">{result.output.slice(-4000)}</pre> : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

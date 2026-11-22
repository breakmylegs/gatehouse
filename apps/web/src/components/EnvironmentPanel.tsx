import { useEffect, useState } from "react"
import { api } from "../lib/api"

interface Reply {
  manifest: { tools: Record<string, string>; pins: Record<string, string>; variables: string[] }
  drift: Array<{ tool: string; wanted: string; from: string; have: string }>
}

/** E-025: the tools this computer has against what the project asks for; variables by name only. */
export function EnvironmentPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [r, setR] = useState<Reply>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    void api<Reply>("POST", "/api/environment", { session: sessionId }).then((x) => (x.ok && x.data ? setR(x.data) : setError(x.error ?? "It could not be read")))
  }, [sessionId])
  return (
    <section aria-label="Environment" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Environment</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sev">
          {error}
        </p>
      ) : !r ? (
        <p className="m-0 text-mut">Asking each tool for its version…</p>
      ) : (
        <>
          <p className="m-0" role="status">
            {r.drift.length ? `${r.drift.length} tool(s) do not match what the project asks for.` : "Everything installed meets what the project asks for."}
          </p>
          {r.drift.length ? (
            <ul className="m-0 grid gap-0.5 pl-5" aria-label="Drift">
              {r.drift.map((d) => (
                <li key={`${d.tool}:${d.from}`} className="text-warn">
                  {d.tool}: {d.from} asks for {d.wanted}, this computer has {d.have}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="m-0 text-mut">
            Installed: {Object.entries(r.manifest.tools).map(([k, v]) => `${k} ${v}`).join(", ") || "none found"}. Kept in .codehouse/environment.json, with
            the {r.manifest.variables.length} environment variables by name only.
          </p>
        </>
      )}
    </section>
  )
}

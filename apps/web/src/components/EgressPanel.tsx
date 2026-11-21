import { useEffect, useState } from "react"
import { send } from "../store"

interface Endpoint {
  remote: string
  port: number
  proto: "tcp" | "udp"
  process: string
  firstSeen: string
  allowed: boolean
  why?: string
}
interface Reply {
  report: { from: string; endpoints: Endpoint[]; flagged: number }
  signed: { report: string; signature: string; publicKey: string }
}

/** D-094: the remote endpoints this session's processes reached, checked against what it may reach, and signed. */
export function EgressPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [r, setR] = useState<Reply>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    void send({ type: "egress_report", sessionId }).then((x) => (x.ok ? setR(x.data as Reply) : setError(x.error?.message ?? "The report could not be made")))
  }, [sessionId])
  function download() {
    if (!r) return
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([JSON.stringify(r.signed)], { type: "application/json" }))
    a.download = "egress-report.signed.json"
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }
  const tcp = (r?.report.endpoints ?? []).filter((e) => e.proto === "tcp")
  return (
    <section aria-label="Egress report" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Where this session connected</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sev">
          {error}
        </p>
      ) : !r ? (
        <p className="m-0 text-mut">Reading…</p>
      ) : (
        <>
          <p className="m-0" role="status">
            {tcp.length === 0
              ? "No outside connection seen yet (checked every minute, on Windows)."
              : r.report.flagged
                ? `${r.report.flagged} connection(s) outside what this session may reach.`
                : "Every connection was to somewhere this session may reach."}
          </p>
          {tcp.length ? (
            <ul className="m-0 grid gap-0.5 pl-5" aria-label="Connections">
              {tcp.map((e) => (
                <li key={`${e.remote}:${e.port}`} className={e.allowed ? undefined : "font-semibold text-sev"}>
                  <span className="mono">
                    {e.remote}:{e.port}
                  </span>{" "}
                  by {e.process || "a process"}, {e.allowed ? `allowed (${e.why})` : "outside its list"}
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="btn w-fit !min-h-7" onClick={download}>
            Download the signed report
          </button>
        </>
      )}
    </section>
  )
}

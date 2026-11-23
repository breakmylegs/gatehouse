import { useEffect, useState } from "react"
import { send } from "../store"

interface Finding {
  rule: "public-storage" | "open-security-group" | "missing-encryption" | "weak-tls" | "missing-diagnostics"
  file: string
  line: number
  resource: string
  message: string
  fix: string
}
interface Reply {
  files: number
  findings: Finding[]
}

const RULE: Record<Finding["rule"], string> = {
  "public-storage": "Public storage",
  "open-security-group": "Open to the internet",
  "missing-encryption": "Not encrypted",
  "weak-tls": "Old TLS allowed",
  "missing-diagnostics": "No logs",
}

/** E-022: misconfigurations in the project's Terraform, Bicep, ARM and CloudFormation, read in process. */
export function IacCheckPanel({ sessionId, onOpen, onClose }: { sessionId: string; onOpen: (file: string, line: number) => void; onClose: () => void }) {
  const [r, setR] = useState<Reply>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    void send({ type: "iac_check", sessionId }).then((x) => (x.ok ? setR(x.data as Reply) : setError(x.error?.message ?? "The infrastructure code could not be checked")))
  }, [sessionId])
  return (
    <section aria-label="Infrastructure checks" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Infrastructure checks</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p className="m-0 text-mut">{error}</p>
      ) : !r ? (
        <p className="m-0 text-mut">Reading…</p>
      ) : !r.files ? (
        <p className="m-0 text-mut">This project has no Terraform, Bicep, ARM or CloudFormation files.</p>
      ) : !r.findings.length ? (
        <p className="m-0 text-mut">{r.files} file(s) checked; nothing found.</p>
      ) : (
        <>
          <p className="m-0 text-mut">
            {r.files} file(s) checked; {r.findings.length} finding(s).
          </p>
          <ul className="m-0 grid list-none gap-2 p-0">
            {r.findings.map((f) => (
              <li key={`${f.file}:${f.line}:${f.rule}:${f.resource}`} className="grid gap-0.5">
                <span>
                  <strong>{RULE[f.rule]}</strong>{" "}
                  <button type="button" className="link" onClick={() => onOpen(f.file, f.line)}>
                    {f.file}:{f.line}
                  </button>{" "}
                  <span className="mono break-words">{f.resource}</span>
                </span>
                <span>{f.message}</span>
                <span className="text-mut">Fix: {f.fix}.</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

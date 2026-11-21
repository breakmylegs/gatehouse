import { useEffect, useState } from "react"
import { send } from "../store"

interface Report {
  file: string
  findings: Array<{ line: number; rule: string; message: string; fix?: string }>
  parseError?: boolean
  analyzer?: boolean
}

/** D-070: what in this project's PowerShell scripts will not run, or runs differently, in PowerShell 7. Nothing runs. */
export function PwshModernisePanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [reports, setReports] = useState<Report[]>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    void send({ type: "pwsh_modernise", sessionId }).then((r) =>
      r.ok ? setReports((r.data as { reports: Report[] }).reports) : setError(r.error?.message ?? "The scripts could not be checked"),
    )
  }, [sessionId])
  const withFindings = (reports ?? []).filter((r) => r.findings.length || r.parseError)
  return (
    <section aria-label="PowerShell 7 check" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">PowerShell 7 check</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sev">
          {error}
        </p>
      ) : !reports ? (
        <p className="m-0 text-mut">Reading the scripts…</p>
      ) : !reports.length ? (
        <p className="m-0 text-mut">This project has no PowerShell scripts.</p>
      ) : (
        <>
          <p className="m-0 text-mut">
            {reports.length} script{reports.length === 1 ? "" : "s"} read{reports.some((r) => r.analyzer) ? ", with PSScriptAnalyzer" : ""};{" "}
            {withFindings.length ? `${withFindings.length} need${withFindings.length === 1 ? "s" : ""} changes for PowerShell 7.` : "none needs changes for PowerShell 7."}
          </p>
          {withFindings.map((r) => (
            <div key={r.file} className="grid gap-0.5 border-t border-line pt-1.5">
              <span className="mono font-semibold">{r.file}</span>
              {r.parseError ? <span className="text-warn">Part of it could not be read.</span> : null}
              <ul className="m-0 grid gap-0.5 pl-5">
                {r.findings.map((f, i) => (
                  <li key={i}>
                    Line {f.line}: {f.message}
                    {f.fix ? ` ${f.fix}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  )
}

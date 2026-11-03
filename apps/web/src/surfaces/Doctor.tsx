import { useCallback, useEffect, useState } from "react"
import { CopyButton } from "../components/CopyButton"
import { Icon, type IconName } from "../components/Icon"
import { api } from "../lib/api"

/** What the Host's checks found (apps/host/src/doctor.ts). */
export interface DoctorCheck {
  id: string
  label: string
  state: "ok" | "warn" | "fail"
  detail: string
  fix?: string
}
interface DoctorResult {
  version: string
  at: string
  checks: DoctorCheck[]
  report: string
}

const MARK: Record<DoctorCheck["state"], { icon: IconName; word: string; className: string }> = {
  ok: { icon: "done", word: "fine", className: "text-ok" },
  warn: { icon: "failed", word: "needs a look", className: "text-warn" },
  fail: { icon: "close", word: "a problem", className: "text-sev" },
}

/** One line for the top of the page: how many checks need something done. */
export function summary(checks: DoctorCheck[]): string {
  const fail = checks.filter((c) => c.state === "fail").length
  const warn = checks.filter((c) => c.state === "warn").length
  if (!fail && !warn)
    return checks.length === 1 ? "The check is fine." : `All ${checks.length} checks are fine.`
  const parts = [
    ...(fail ? [fail === 1 ? "1 problem" : `${fail} problems`] : []),
    ...(warn ? [warn === 1 ? "1 thing to look at" : `${warn} things to look at`] : []),
  ]
  return `${parts.join(" and ")}. What to do is under each one.`
}

/**
 * The Doctor (B07): what Codehouse needs to work safely on this computer, checked now, each with what to do. The
 * report to copy names no email address, token or file path of yours.
 */
export function Doctor() {
  const [result, setResult] = useState<DoctorResult>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const run = useCallback(async () => {
    setBusy(true)
    const r = await api<DoctorResult>("GET", "/api/doctor")
    setBusy(false)
    if (r.ok && r.data) {
      setResult(r.data)
      setError(undefined)
    } else setError(r.error ?? "The checks could not run.")
  }, [])
  useEffect(() => {
    void run()
  }, [run])

  return (
    <section aria-labelledby="doctor-title" className="mx-auto grid max-w-3xl gap-4 p-6">
      <div>
        <h1 id="doctor-title" className="m-0">
          Doctor
        </h1>
        <p className="m-0 mt-1 text-mut">
          What Codehouse needs to work safely on this computer, checked now.
        </p>
      </div>
      <p role="status" className="m-0 font-semibold">
        {busy && !result ? "Checking." : error ? error : result ? summary(result.checks) : ""}
      </p>
      {result ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {result.checks.map((c) => {
            const m = MARK[c.state]
            return (
              <li key={c.id} className="panel doctor-check" data-state={c.state}>
                <Icon name={m.icon} size={18} className={m.className} />
                <div className="grid gap-1">
                  <span>
                    <strong>{c.label}</strong>
                    <span className="sr-only">, {m.word}</span>
                  </span>
                  <span className="text-[14px]">{c.detail}</span>
                  {c.fix ? (
                    <span className="text-[14px]">
                      <strong>What to do:</strong> {c.fix}
                    </span>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void run()}
        >
          {busy ? "Checking" : "Run the checks again"}
        </button>
        {result ? (
          <CopyButton
            text={result.report}
            label="Copy the report"
            what="the report"
            className="btn"
          />
        ) : null}
      </div>
      {result ? (
        <p className="m-0 text-xs text-mut">
          Codehouse {result.version}, checked at{" "}
          {new Date(result.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. The
          report names no email address, token or file path of yours.
        </p>
      ) : null}
    </section>
  )
}

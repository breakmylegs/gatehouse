import { useCallback, useEffect, useState } from "react"
import { send } from "../store"

/**
 * O59 (owner, 27 Nov): what secret-in-commit last held in each repository (never a value), with Allow once for one
 * finding, which covers the next commit or push there that finds exactly it, and Clear. The desktop only; both are
 * recorded in the audit log by the Host.
 */
interface Finding {
  kind: string
  file: string
  line?: number
  commit?: string
  branch?: string
  allowedOnce: boolean
}
interface Held {
  repo: string
  at: string
  findings: Finding[]
}

export function SecretHoldsPanel() {
  const [repos, setRepos] = useState<Held[]>()
  const [error, setError] = useState<string>()
  const [confirming, setConfirming] = useState<string>()
  const load = useCallback(async () => {
    const r = await send({ type: "secret_holds" })
    if (r.ok) setRepos((r.data as { repos: Held[] }).repos)
    else setError(r.error?.message ?? "Could not read what is held.")
  }, [])
  useEffect(() => void load(), [load])

  const act = async (cmd: Parameters<typeof send>[0]) => {
    setError(undefined)
    const r = await send(cmd)
    if (!r.ok) setError(r.error?.message ?? "That did not work.")
    setConfirming(undefined)
    await load()
  }

  if (repos === undefined) return <p className="m-0 text-sm text-mut">{error ?? "Reading what is held…"}</p>
  return (
    <div className="grid gap-2">
      {error ? (
        <p role="alert" className="m-0 text-sm text-sev">
          {error}
        </p>
      ) : null}
      {repos.length === 0 ? (
        <p className="m-0 text-sm text-mut">Nothing is held. Each commit and push is checked again from git each time.</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0" aria-label="Held for secrets">
          {repos.map((h) => (
            <li key={h.repo} className="grid gap-1.5 rounded-md border border-line p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="mono break-all text-[13px]">{h.repo}</span>
                <button type="button" className="btn" onClick={() => void act({ type: "secret_holds_clear", repo: h.repo })}>
                  Clear
                </button>
              </div>
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {h.findings.map((f) => {
                  const id = `${h.repo}\u0000${f.kind}\u0000${f.file}\u0000${f.line ?? ""}`
                  const where = `${f.kind} in ${f.file || "a staged file"}${f.line ? `, line ${f.line}` : ""}${f.commit ? ` of commit ${f.commit}` : ""}${f.branch ? ` on branch ${f.branch}` : ""}`
                  return (
                    <li key={id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                      <span className="min-w-0 break-words">{where}</span>
                      {f.allowedOnce ? (
                        <span className="text-mut">Allowed once, for the next commit or push</span>
                      ) : confirming === id ? (
                        <span className="flex gap-1.5">
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() =>
                              void act({ type: "secret_allow_once", repo: h.repo, kind: f.kind, file: f.file, ...(f.line ? { line: f.line } : {}) })
                            }
                          >
                            Yes, it is not a secret
                          </button>
                          <button type="button" className="btn" onClick={() => setConfirming(undefined)}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button type="button" className="btn" aria-label={`Allow once: ${where}`} onClick={() => setConfirming(id)}>
                          Allow once
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

import { useEffect, useState } from "react"
import { send } from "../store"

interface Step {
  name: string
  up: "ok" | "failed"
  down: "ok" | "failed" | "missing" | "not run"
  restores?: boolean
  error?: string
}
interface Reply {
  engine: "sqlite" | "postgres" | "none"
  steps: Step[]
  irreversible: string[]
  failures: string[]
  notRun?: string
}

const ENGINE = { sqlite: "SQLite", postgres: "Postgres in a container", none: "" }

function verdict(s: Step): string {
  if (s.error) return `failed (${s.error})`
  if (s.down === "missing") return "irreversible: it has no down step"
  if (s.restores === false) return "irreversible: its down step leaves the schema different"
  return "up and down"
}

/** E-013: the project's migrations up, down and up again against a throwaway database, deleted afterwards. */
export function RehearsalPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [r, setR] = useState<Reply>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    void send({ type: "migration_rehearse", sessionId }).then((x) => (x.ok ? setR(x.data as Reply) : setError(x.error?.message ?? "The migrations could not be rehearsed")))
  }, [sessionId])
  return (
    <section aria-label="Migration rehearsal" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Migration rehearsal</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p className="m-0 text-mut">{error}</p>
      ) : !r ? (
        <p className="m-0 text-mut">Rehearsing in a throwaway database…</p>
      ) : r.notRun ? (
        <p className="m-0">{r.notRun}</p>
      ) : (
        <>
          <p className="m-0 text-mut">
            {r.steps.length} migration(s) on {ENGINE[r.engine]}: {r.irreversible.length} irreversible, {r.failures.length} failed. The database has been deleted.
          </p>
          <ul className="m-0 grid gap-1 pl-4">
            {r.steps.map((s) => (
              <li key={s.name} className="break-words">
                <span className="mono">{s.name}</span>: {verdict(s)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

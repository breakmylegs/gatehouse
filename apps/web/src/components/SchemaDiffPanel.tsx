import { useEffect, useState } from "react"
import { send } from "../store"

interface Reply {
  source: "migrations" | "ddl" | "prisma" | "ef"
  files: string[]
  summary: string[]
  artifact?: { id: string; version: number }
}

const SOURCE: Record<Reply["source"], string> = {
  migrations: "SQL migrations",
  ddl: "the DDL",
  prisma: "the Prisma schema",
  ef: "the EF Core model snapshot",
}

/** E-012: the schema at the last commit against the working folder, in words, with the ER diff in Artifacts. */
export function SchemaDiffPanel({ sessionId, onOpenArtifacts, onClose }: { sessionId: string; onOpenArtifacts: () => void; onClose: () => void }) {
  const [r, setR] = useState<Reply>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    void send({ type: "schema_diff", sessionId }).then((x) => (x.ok ? setR(x.data as Reply) : setError(x.error?.message ?? "The schema could not be read")))
  }, [sessionId])
  return (
    <section aria-label="Schema changes" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Schema changes</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p className="m-0 text-mut">{error}</p>
      ) : !r ? (
        <p className="m-0 text-mut">Reading…</p>
      ) : (
        <>
          <p className="m-0 text-mut">
            From {SOURCE[r.source]} ({r.files.length === 1 ? r.files[0] : `${r.files.length} files`}), the last commit against the working folder.
          </p>
          {r.summary.length ? (
            <ul className="m-0 grid gap-1 pl-4">
              {r.summary.map((line) => (
                <li key={line} className="mono break-words">
                  {line}
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0">No table or column has changed.</p>
          )}
          {r.artifact ? (
            <button type="button" className="btn btn-primary !min-h-7 justify-self-start" onClick={onOpenArtifacts}>
              See the diagram in Artifacts
            </button>
          ) : null}
        </>
      )}
    </section>
  )
}

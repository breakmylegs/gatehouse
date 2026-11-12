import { useEffect, useState } from "react"
import { send } from "../store"

/**
 * D-033: the project's requirements (docs\requirements), each with the commits that name it, its tests and the
 * evidence packs of those commits; the gaps first, and the files that could not be read cleanly.
 */
interface Row {
  id: string
  title: string
  file: string
  status?: string
  commits: string[]
  tests: string[]
  evidence: string[]
  gaps: string[]
}

export function Requirements({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [data, setData] = useState<{ dir: string; rows: Row[]; problems: Array<{ file: string; problem: string }> }>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    void send({ type: "requirements", sessionId }).then((r) =>
      r.ok ? setData(r.data as NonNullable<typeof data>) : setError(r.error?.message ?? "The requirements could not be read"),
    )
  }, [sessionId])
  const gaps = data?.rows.filter((r) => r.gaps.length) ?? []
  return (
    <section aria-label="Requirements" className="panel grid gap-3 p-4 text-[13px]">
      <div className="flex items-center gap-2">
        <h2 className="m-0 text-[17px]">Requirements</h2>
        <span className="text-mut">{data ? `From ${data.dir.replace(/\//g, "\\")} in the project.` : ""}</span>
        <button type="button" className="btn ml-auto !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sev">
          {error}
        </p>
      ) : !data ? (
        <p className="m-0 text-mut">Reading…</p>
      ) : !data.rows.length && !data.problems.length ? (
        <p className="m-0 text-mut">
          This project has no requirements yet. Add one Markdown file per requirement to docs\requirements, with front matter
          such as id: REQ-001 and title, and optionally tests and files it concerns.
        </p>
      ) : (
        <>
          {gaps.length ? (
            <div className="grid gap-1">
              <h3 className="m-0 text-[13.5px] font-semibold">Gaps ({gaps.length})</h3>
              <ul className="m-0 grid list-none gap-1 p-0">
                {gaps.map((r) => (
                  <li key={r.id}>
                    <strong className="mono">{r.id}</strong> {r.title}: <span className="text-sev">{r.gaps.join("; ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <table className="w-full border-collapse text-left" aria-label="Trace matrix">
            <thead>
              <tr className="text-mut">
                <th className="py-1 pr-2 font-normal">Requirement</th>
                <th className="py-1 pr-2 font-normal">Commits</th>
                <th className="py-1 pr-2 font-normal">Tests</th>
                <th className="py-1 font-normal">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="py-1 pr-2">
                    <strong className="mono">{r.id}</strong> {r.title}
                    {r.status ? <span className="text-mut"> ({r.status})</span> : null}
                  </td>
                  <td className="mono py-1 pr-2">{r.commits.length ? r.commits.map((c) => c.slice(0, 8)).join(" ") : "none"}</td>
                  <td className="mono py-1 pr-2 [overflow-wrap:anywhere]">{r.tests.length ? r.tests.join(", ") : "none"}</td>
                  <td className="mono py-1">{r.evidence.length ? r.evidence.map((e) => e.slice(0, 8)).join(" ") : "none"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.problems.length ? (
            <div className="grid gap-1">
              <h3 className="m-0 text-[13.5px] font-semibold">Read with care</h3>
              <ul className="m-0 grid list-none gap-1 p-0 text-mut">
                {data.problems.map((p) => (
                  <li key={`${p.file}:${p.problem}`}>
                    <span className="mono">{p.file}</span>: {p.problem}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

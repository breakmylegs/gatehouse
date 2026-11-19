import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { useSessionList } from "../store"

/**
 * D-068: dead code in a project, with its evidence: names nothing else uses, names only tests use, and files nothing
 * imports, each with what the tests' coverage says, and removal in small slices to hand to a session one at a time.
 */
type Coverage = { state: "never run" | "run" | "not in the report"; calls?: number }
interface Report {
  scope: { root: string; files: number; tests: number; leftOut: string[] }
  coverage?: { report: string; ageDays: number }
  names: Array<{ name: string; kind: string; file: string; line: number; why: "unreferenced" | "tests-only"; evidence: string; coverage?: Coverage }>
  files: Array<{ file: string; evidence: string; coverage?: Coverage }>
  slices: Array<{ title: string; file: string; names: string[]; prompt: string }>
}

const covText = (c?: Coverage) => (!c ? "" : c.state === "run" ? `; the tests run it${c.calls ? ` (${c.calls} calls)` : ""}` : `; the tests ${c.state === "never run" ? "never run it" : "do not load it"}`)

export function DeadCode() {
  const sessions = useSessionList()
  const folders = useMemo(() => {
    const seen = new Map<string, { id: string; project: string }>()
    for (const s of sessions) if (s.state !== "ended" && !seen.has(s.cwd)) seen.set(s.cwd, { id: s.id, project: s.project })
    return [...seen.values()]
  }, [sessions])
  const [chosen, setChosen] = useState<string>()
  const id = chosen ?? folders[0]?.id
  const [report, setReport] = useState<Report>()
  const [busy, setBusy] = useState(false)
  useEffect(() => setReport(undefined), [id])
  if (!folders.length) return null
  const look = async () => {
    if (!id) return
    setBusy(true)
    const r = await api<Report>("GET", `/api/insights/dead-code?session=${encodeURIComponent(id)}`)
    setBusy(false)
    if (r.ok && r.data) setReport(r.data)
    else toast.error(r.error ?? "The code could not be read.", { id: "dead" })
  }
  const copy = (text: string) =>
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success("Copied. Paste it into the session as its next task.", { id: "dead" }))
      .catch(() => toast.error("It could not be copied", { id: "dead" }))
  const unused = report?.names.filter((n) => n.why === "unreferenced") ?? []
  const testsOnly = report?.names.filter((n) => n.why === "tests-only") ?? []
  return (
    <section aria-label="Dead code" className="grid gap-2">
      <h2 className="m-0 text-[18px]">Dead code</h2>
      <p className="m-0 max-w-[720px] text-[13px] text-mut">
        Code nothing uses, with the evidence: what names it, and what the tests' coverage says when the project has a report. A name used through a string or a framework's convention is not seen, so remove it a slice at a time and run the tests after each.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="text-[13px] text-mut">Project</span>
          <select className="field" value={id} onChange={(e) => setChosen(e.target.value)}>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.project}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" disabled={busy} onClick={() => void look()}>
          {busy ? "Reading the code..." : "Find dead code"}
        </button>
      </div>
      {report ? (
        <>
          <p className="m-0" role="status">
            {report.scope.files} files read: {unused.length} unused name{unused.length === 1 ? "" : "s"}, {testsOnly.length} used only by tests, {report.files.length} file{report.files.length === 1 ? "" : "s"} nothing imports.{" "}
            {report.coverage
              ? `Coverage from ${report.coverage.report}, ${report.coverage.ageDays === 0 ? "made today" : `${report.coverage.ageDays} day${report.coverage.ageDays === 1 ? "" : "s"} old`}.`
              : "No coverage report was found (run the tests with coverage for that evidence)."}
          </p>
          {report.slices.length ? (
            <>
              <h3 className="m-0 text-[15px]">Removal, a slice at a time</h3>
              <ul className="m-0 grid list-none gap-1 p-0 text-[13px]">
                {report.slices.map((s) => (
                  <li key={s.title} className="flex flex-wrap items-center gap-2">
                    <span className="mono">{s.title}</span>
                    <button type="button" className="btn" onClick={() => copy(s.prompt)}>
                      Copy as a task
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {report.names.length ? (
            <>
              <h3 className="m-0 text-[15px]">The evidence</h3>
              <ul className="m-0 grid list-none gap-0.5 p-0 text-[13px]">
                {report.names.slice(0, 60).map((n) => (
                  <li key={`${n.file}:${n.line}:${n.name}`}>
                    <span className="font-semibold">{n.name}</span> ({n.kind}), <span className="mono">{n.file}</span> line {n.line}: {n.evidence.replace(/\.$/, "")}
                    {covText(n.coverage)}.
                  </li>
                ))}
                {report.files.slice(0, 30).map((f) => (
                  <li key={f.file}>
                    <span className="mono">{f.file}</span>: {f.evidence.replace(/\.$/, "")}
                    {covText(f.coverage)}.
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

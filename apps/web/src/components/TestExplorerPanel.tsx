import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { composeIn } from "../lib/compose"
import { Viewer, type Opened } from "./FilesPanel"

type Runner = "vitest" | "jest" | "pytest" | "dotnet"
interface TestCase {
  name: string
  line: number
}
interface TestFile {
  file: string
  runner: Runner
  tests: TestCase[]
}
interface TestResult {
  file: string
  name: string
  status: "passed" | "failed" | "skipped"
  message?: string
  line?: number
}
interface Outcome {
  runner: Runner
  results: TestResult[]
  exitCode: number | null
  timedOut: boolean
  tail: string
}

const RUNNER_NAMES: Record<Runner, string> = { vitest: "Vitest", jest: "Jest", pytest: "pytest", dotnet: "dotnet test" }
const STATUS_WORDS: Record<TestResult["status"], string> = { passed: "Passed", failed: "Failed", skipped: "Skipped" }

/** A scoped task for one failure, for you to read and send: fix the code, not the test. */
export function fixPrompt(r: TestResult): string {
  const text = (r.message ?? "It failed with no message.").replace(/\s+$/, "")
  const fence = text.includes("```") ? "````" : "```"
  return (
    `The test "${r.name}" in ${r.file}${r.line ? ` (line ${r.line})` : ""} fails:\n\n${fence}text\n${text}\n${fence}\n\n` +
    "Fix the code so this test passes. Change only what this failure needs, and do not weaken, skip or delete the test."
  )
}

/** The result for a listed test: by its name, or by its last part when the runner names it without its suites. */
const resultFor = (results: TestResult[], file: string, name: string) =>
  results.find((r) => r.file === file && (r.name === name || r.name === name.split(" > ").at(-1) || r.name.endsWith(`::${name}`)))

/**
 * G38 (owner's connector items, 9 Nov): the project's tests a file at a time, as the project's own runner names them,
 * read from the files and never run to list them. Run starts that runner, for a file or one test; a failure opens at
 * its line, and Fix this puts a scoped task in the prompt box (nothing is sent until you send it).
 */
export function TestExplorerPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [view, setView] = useState<{ runners: Runner[]; files: TestFile[] }>()
  const [error, setError] = useState<string>()
  const [running, setRunning] = useState<string>()
  const [results, setResults] = useState<TestResult[]>([])
  const [problem, setProblem] = useState<string>()
  const [opened, setOpened] = useState<Opened>()

  useEffect(() => {
    void api<{ runners: Runner[]; files: TestFile[] }>("GET", `/api/tests?session=${encodeURIComponent(sessionId)}`).then((r) =>
      r.ok && r.data ? setView(r.data) : setError(r.error ?? "The tests could not be read."),
    )
  }, [sessionId])

  const run = async (runner: Runner, file?: string, name?: string) => {
    const key = `${runner}:${file ?? ""}:${name ?? ""}`
    setRunning(key)
    setProblem(undefined)
    const r = await api<Outcome>("POST", "/api/tests/run", { session: sessionId, runner, ...(file ? { file } : {}), ...(name ? { name } : {}) })
    setRunning(undefined)
    if (!r.ok || !r.data) return void toast.error(r.error ?? "The tests could not be run.", { id: "tests" })
    const o = r.data
    // What ran replaces what was known for it; the rest is kept.
    setResults((was) => [...was.filter((x) => !o.results.some((n) => n.file === x.file && n.name === x.name)), ...o.results])
    const failed = o.results.filter((x) => x.status === "failed").length
    if (o.timedOut) setProblem("The run took too long and was stopped.")
    else if (!o.results.length) setProblem(`${RUNNER_NAMES[runner]} reported no results (exit code ${o.exitCode ?? "none"}). What it printed last:\n${o.tail.slice(-2000)}`)
    toast(failed ? `${failed} failed of ${o.results.length}.` : `${o.results.length} passed.`, { id: "tests" })
  }

  const failures = results.filter((r) => r.status === "failed")
  const busy = running !== undefined
  return (
    <section aria-label="Test explorer" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-[15px]">Tests</h2>
        {view?.runners.map((r) => (
          <button key={r} type="button" className="btn !min-h-7" disabled={busy} onClick={() => void run(r)}>
            {running === `${r}::` ? "Running…" : `Run all (${RUNNER_NAMES[r]})`}
          </button>
        ))}
        <button type="button" className="btn ml-auto !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sev">
          {error}
        </p>
      ) : !view ? (
        <p className="m-0 text-mut">Reading the tests…</p>
      ) : !view.files.length ? (
        <p className="m-0 text-mut">
          {view.runners.length
            ? "No test files were found."
            : "No test runner was found: Vitest or Jest in package.json, pytest's settings or test_ files, or a .NET test project."}
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label="Test files">
          {view.files.map((f) => (
            <li key={f.file} className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mono font-semibold [overflow-wrap:anywhere]">{f.file}</span>
                <span className="text-xs text-mut">{RUNNER_NAMES[f.runner]}</span>
                <button type="button" className="btn !min-h-6 !px-2 !text-[12.5px]" disabled={busy} aria-label={`Run ${f.file}`} onClick={() => void run(f.runner, f.file)}>
                  {running === `${f.runner}:${f.file}:` ? "Running…" : "Run file"}
                </button>
              </div>
              <ul className="m-0 grid list-none gap-0.5 p-0 pl-4">
                {f.tests.map((t) => {
                  const r = resultFor(results, f.file, t.name)
                  return (
                    <li key={`${t.name}:${t.line}`} className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold" data-status={r?.status ?? "unknown"}>
                        {r ? STATUS_WORDS[r.status] : "Not run"}
                      </span>
                      <span className="[overflow-wrap:anywhere]">{t.name}</span>
                      <span className="text-xs text-mut">line {t.line}</span>
                      <button type="button" className="btn !min-h-6 !px-2 !text-[12.5px]" disabled={busy} aria-label={`Run ${t.name}`} onClick={() => void run(f.runner, f.file, t.name)}>
                        Run
                      </button>
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {problem ? (
        <pre role="status" className="m-0 whitespace-pre-wrap text-[12.5px] text-mut">
          {problem}
        </pre>
      ) : null}
      {failures.length ? (
        <section aria-label="Failures" className="grid gap-2">
          <h3 className="m-0 text-[14px]">Failures</h3>
          {failures.map((r) => (
            <article key={`${r.file}:${r.name}`} aria-label={`${r.name} failed`} className="grid gap-1 rounded-md border border-line p-2">
              <strong className="[overflow-wrap:anywhere]">{r.name}</strong>
              <span className="mono text-xs text-mut">
                {r.file}
                {r.line ? `, line ${r.line}` : ""}
              </span>
              {r.message ? <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap text-[12.5px]">{r.message}</pre> : null}
              <div className="flex flex-wrap gap-2">
                {r.file ? (
                  <button type="button" className="btn !min-h-7" onClick={() => setOpened({ kind: "file", rel: r.file, ...(r.line ? { line: r.line } : {}) })}>
                    {r.line ? `Open at line ${r.line}` : "Open the file"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-primary !min-h-7"
                  onClick={() => {
                    composeIn(sessionId, fixPrompt(r))
                    toast("The task is in the prompt box. Read it, then send it.", { id: "tests" })
                  }}
                >
                  Fix this
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : null}
      {opened ? (
        <div className="h-[50vh] min-h-0">
          <Viewer key={opened.kind === "file" ? `${opened.rel}:${opened.line ?? 0}` : "x"} sessionId={sessionId} opened={opened} onClose={() => setOpened(undefined)} onNavigate={setOpened} />
        </div>
      ) : null}
    </section>
  )
}

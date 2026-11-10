import { useEffect, useState } from "react"
import { api } from "../lib/api"
import { TEST_RUN, type Item, type Todo } from "../lib/transcript"
import { send, useStore } from "../store"
import { CopyButton } from "./CopyButton"

/**
 * The evidence for a session's work in one place (backlog G31): its plan and the commits made for each step, the files
 * it changed, every test run and whether it passed, and the decisions that were not the rules allowing by themselves
 * (a person's, Extreme approval's, and every call stopped), each with its audit record, which Open record shows on the
 * Audit page. Copy gives it all as Markdown, to put in a pull request or a report.
 */

interface AuditRec {
  seq: number
  ts: string
  tool: string
  event: string
  verdict: { outcome: string; ruleId: string; reason: string; risk: number; decidedBy: string }
}

interface FileChange {
  path: string
  change: string
  added: number
  removed: number
}

export interface TestRun {
  command: string
  passed: boolean
}

/** The test runs in a transcript, in order, with whether each passed (G17's reading of a test command). */
export function testRuns(items: readonly Item[]): TestRun[] {
  const out: TestRun[] = []
  for (const it of items) {
    if (it.kind !== "tool" || (it.name !== "Bash" && it.name !== "PowerShell") || !it.result)
      continue
    const command = typeof it.input.command === "string" ? it.input.command : ""
    if (TEST_RUN.test(command)) out.push({ command, passed: !it.result.isError })
  }
  return out
}

/** The decisions worth showing: a person's, Extreme approval's, the judge's, and every call that was not allowed. */
export function notable(records: readonly AuditRec[]): AuditRec[] {
  return records.filter(
    (r) =>
      r.verdict.outcome !== "allow" ||
      r.verdict.decidedBy.startsWith("human") ||
      r.verdict.decidedBy === "extreme-mode" ||
      r.verdict.decidedBy === "judge",
  )
}

const WHO: Record<string, string> = {
  "human-desktop": "you, on this computer",
  "human-phone": "you, on your phone",
  "human-push": "you, from a notification",
  "extreme-mode": "Extreme approval",
  judge: "the judge",
  rules: "your rules",
  floor: "the always-blocked list",
  timeout: "nobody in time",
}

const decisionWords = (r: AuditRec) =>
  `${r.verdict.outcome === "allow" ? "Allowed" : r.verdict.outcome === "deny" ? "Denied" : "Asked"} by ${WHO[r.verdict.decidedBy] ?? r.verdict.decidedBy}: ${r.tool}, rule ${r.verdict.ruleId}, risk ${r.verdict.risk}`

/** The walkthrough as Markdown. */
export function walkthroughMarkdown(w: {
  title: string
  todos: readonly Todo[]
  files: readonly FileChange[]
  tests: readonly TestRun[]
  decisions: readonly AuditRec[]
}): string {
  const lines = [`# Walkthrough: ${w.title}`, "", "## Plan"]
  if (!w.todos.length) lines.push("No plan was written.")
  for (const t of w.todos)
    lines.push(
      `- [${t.status === "completed" ? "x" : " "}] ${t.content}${t.commits?.length ? ` (${t.commits.join(", ")})` : ""}${t.afterFailedTests ? " (ticked while the tests were failing)" : ""}`,
    )
  lines.push("", "## Changes")
  if (!w.files.length) lines.push("Nothing changed.")
  for (const f of w.files) lines.push(`- ${f.path}: ${f.change}, +${f.added} -${f.removed}`)
  lines.push("", "## Tests")
  if (!w.tests.length) lines.push("No tests were run.")
  for (const t of w.tests) lines.push(`- ${t.passed ? "Passed" : "Failed"}: \`${t.command}\``)
  lines.push("", "## Decisions")
  if (!w.decisions.length) lines.push("Every call was allowed by your rules.")
  for (const d of w.decisions) lines.push(`- Record ${d.seq}: ${decisionWords(d)}`)
  return lines.join("\n") + "\n"
}

export function Walkthrough({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const session = useStore((s) => s.sessions[sessionId])
  const transcript = useStore((s) => s.transcripts[sessionId])
  const setRoute = useStore((s) => s.setRoute)
  const [files, setFiles] = useState<FileChange[]>()
  const [records, setRecords] = useState<AuditRec[]>()
  useEffect(() => {
    void send({ type: "changes", sessionId }).then((r) =>
      setFiles(r.ok ? ((r.data as { files?: FileChange[] }).files ?? []) : []),
    )
    void api<{ records: AuditRec[] }>(
      "GET",
      `/api/audit?session=${encodeURIComponent(sessionId)}&limit=500`,
    ).then((r) => setRecords(r.ok && r.data ? notable(r.data.records).reverse() : []))
  }, [sessionId])
  const todos = transcript?.todos ?? []
  const tests = testRuns(transcript?.items ?? [])
  const title = session?.title ?? session?.project ?? "this session"
  const openRecord = (seq: number) => {
    useStore.setState({ auditOpen: seq })
    setRoute("audit")
    onClose()
  }
  return (
    <section aria-label={`Walkthrough of ${title}`} className="panel grid gap-3 p-4">
      <div className="flex items-center gap-2">
        <h2 className="m-0 text-[17px]">Walkthrough</h2>
        <span className="ml-auto flex gap-2">
          <CopyButton
            text={() =>
              walkthroughMarkdown({
                title,
                todos,
                files: files ?? [],
                tests,
                decisions: records ?? [],
              })
            }
            what="the walkthrough"
          />
          <button type="button" className="btn !min-h-7" onClick={onClose}>
            Close
          </button>
        </span>
      </div>

      <div className="grid gap-1">
        <h3 className="m-0 text-[14px]">Plan</h3>
        {todos.length ? (
          <ul className="m-0 grid list-none gap-0.5 p-0 text-[13.5px]">
            {todos.map((t, i) => (
              <li key={`${i}-${t.content}`}>
                {t.status === "completed"
                  ? "Done"
                  : t.status === "in_progress"
                    ? "Doing"
                    : "Not started"}
                : {t.content}
                {t.commits?.length ? (
                  <span className="mono text-mut"> {t.commits.join(", ")}</span>
                ) : null}
                {t.afterFailedTests ? (
                  <span className="font-semibold"> (ticked while the tests were failing)</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[13.5px] text-mut">No plan was written.</p>
        )}
      </div>

      <div className="grid gap-1">
        <h3 className="m-0 text-[14px]">Changes</h3>
        {files === undefined ? (
          <p className="m-0 text-[13.5px] text-mut">Reading the changes…</p>
        ) : files.length ? (
          <ul className="m-0 grid list-none gap-0.5 p-0 text-[13px]">
            {files.map((f) => (
              <li key={f.path} className="mono">
                {f.path}{" "}
                <span className="text-mut">
                  +{f.added} -{f.removed}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[13.5px] text-mut">Nothing changed.</p>
        )}
      </div>

      <div className="grid gap-1">
        <h3 className="m-0 text-[14px]">Tests</h3>
        {tests.length ? (
          <ul className="m-0 grid list-none gap-0.5 p-0 text-[13px]">
            {tests.map((t, i) => (
              <li key={i}>
                <span className={t.passed ? "font-semibold" : "font-semibold text-sev"}>
                  {t.passed ? "Passed" : "Failed"}
                </span>{" "}
                <span className="mono">{t.command}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[13.5px] text-mut">No tests were run.</p>
        )}
      </div>

      <div className="grid gap-1">
        <h3 className="m-0 text-[14px]">Decisions</h3>
        {records === undefined ? (
          <p className="m-0 text-[13.5px] text-mut">Reading the audit log…</p>
        ) : records.length ? (
          <ul className="m-0 grid list-none gap-1 p-0 text-[13px]">
            {records.map((r) => (
              <li key={r.seq} className="flex flex-wrap items-center gap-2">
                <span className="mono text-mut">Record {r.seq}</span>
                <span>{decisionWords(r)}</span>
                <button
                  type="button"
                  className="btn !min-h-6 !px-2 !text-[12px]"
                  aria-label={`Open record ${r.seq}`}
                  onClick={() => openRecord(r.seq)}
                >
                  Open record
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[13.5px] text-mut">Every call was allowed by your rules.</p>
        )}
      </div>
    </section>
  )
}

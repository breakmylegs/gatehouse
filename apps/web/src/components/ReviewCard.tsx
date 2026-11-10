import { createContext, useContext, useState } from "react"
import { toast } from "sonner"
import { composeIn } from "../lib/compose"
import { send } from "../store"

/**
 * A local code review as a card (backlog G16). Claude reviews the session's changes when asked (Ask for a review, in
 * the Changes pane) and writes its findings as a `codehouse-review` block; the reply shows that block as this card:
 * the findings grouped by file, each with Fix this one and Dismiss, and Fix all for those left. Fixing only puts the
 * request in the prompt box, for you to send; a dismissal is recorded in the audit log. The block is Claude's words,
 * so it is only ever read as data and drawn as text.
 */

export interface Finding {
  file: string
  line?: number
  severity: "high" | "medium" | "low"
  summary: string
  detail?: string
}

/** The fence language Claude is asked to use. */
export const REVIEW_FENCE = "codehouse-review"

/** What Ask for a review puts in the prompt box. */
export const REVIEW_PROMPT = `Review the changes made in this session for bugs, security problems and anything that would surprise a reader. Do not change anything yet. Report each finding in one fenced block whose language is ${REVIEW_FENCE}, holding a JSON array of objects with "file" (relative path), "line" (number, optional), "severity" ("high", "medium" or "low"), "summary" (one sentence) and "detail" (optional: why, and what to change). An empty array means you found nothing.`

const MAX_FINDINGS = 100
const SEVERITIES = ["high", "medium", "low"] as const
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "")

/** The findings in a block, or undefined when it is not a list of findings (then it shows as plain code). */
export function parseFindings(block: string): Finding[] | undefined {
  let v: unknown
  try {
    v = JSON.parse(block)
  } catch {
    return undefined
  }
  const list = Array.isArray(v) ? v : (v as { findings?: unknown } | null)?.findings
  if (!Array.isArray(list)) return undefined
  const out: Finding[] = []
  for (const x of list.slice(0, MAX_FINDINGS)) {
    const o = (x ?? {}) as Record<string, unknown>
    const file = text(o.file, 300)
    const summary = text(o.summary, 500)
    if (!file || !summary) continue
    const severity = SEVERITIES.find((s) => s === o.severity) ?? "medium"
    const line =
      typeof o.line === "number" && Number.isInteger(o.line) && o.line > 0 ? o.line : undefined
    const detail = text(o.detail, 4000)
    out.push({ file, severity, summary, ...(line ? { line } : {}), ...(detail ? { detail } : {}) })
  }
  return out
}

const where = (f: Finding) => (f.line ? `${f.file}, line ${f.line}` : f.file)
const asked = (f: Finding) =>
  `${where(f)} (${f.severity}): ${f.summary}${f.detail ? `\n${f.detail}` : ""}`

/** The prompt for fixing one finding, or several. */
export function fixPrompt(findings: readonly Finding[]): string {
  return findings.length === 1
    ? `Fix only this finding from your review, and nothing else:\n\n${asked(findings[0]!)}\n`
    : `Fix these findings from your review, one at a time, and nothing else:\n\n${findings
        .map((f, i) => `${i + 1}. ${asked(f)}`)
        .join("\n\n")}\n`
}

/** A finding's key, to keep it dismissed in this window. */
const keyOf = (f: Finding) => `${f.file}\n${f.line ?? ""}\n${f.summary}`
const STORE = (sessionId: string) => `codeh.review.dismissed.${sessionId}`

function readDismissed(sessionId: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE(sessionId)) ?? "[]") as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

/** The session a reply belongs to, so a review card in it can act on that session. */
export const ReviewSession = createContext<string | undefined>(undefined)

export function ReviewCard({ findings }: { findings: Finding[] }) {
  const sessionId = useContext(ReviewSession)
  const [dismissed, setDismissed] = useState<string[]>(() =>
    sessionId ? readDismissed(sessionId) : [],
  )
  const left = findings.filter((f) => !dismissed.includes(keyOf(f)))
  const files = [...new Set(left.map((f) => f.file))]

  const dismiss = async (f: Finding) => {
    if (!sessionId) return
    const r = await send({ type: "review_dismiss", sessionId, file: f.file, summary: f.summary })
    if (!r.ok) {
      toast.error(r.error?.message ?? "It could not be recorded, so it stays.")
      return
    }
    const next = [...dismissed, keyOf(f)]
    setDismissed(next)
    try {
      localStorage.setItem(STORE(sessionId), JSON.stringify(next.slice(-500)))
    } catch {
      // storage blocked: dismissed until the window closes
    }
  }
  const fix = (list: Finding[]) => {
    if (!sessionId) return
    composeIn(sessionId, fixPrompt(list))
    toast("It is in the prompt box. Read and send.")
  }

  return (
    <section className="panel my-2 grid gap-2 p-3" aria-label="Review findings">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-[14px]">Review</strong>
        <span className="text-[13px] text-mut">
          {findings.length === 0
            ? "Nothing found."
            : left.length === 0
              ? "Every finding is fixed or dismissed."
              : `${left.length === 1 ? "1 finding" : `${left.length} findings`} in ${files.length === 1 ? "1 file" : `${files.length} files`}${
                  findings.length > left.length
                    ? `, ${findings.length - left.length} dismissed`
                    : ""
                }`}
        </span>
        {left.length > 1 && sessionId ? (
          <button type="button" className="btn !min-h-7 ml-auto" onClick={() => fix(left)}>
            Fix all {left.length}
          </button>
        ) : null}
      </div>
      {files.map((file) => (
        <div key={file} className="grid gap-1">
          <h3 className="mono m-0 text-[13px] font-semibold">{file}</h3>
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {left
              .filter((f) => f.file === file)
              .map((f) => (
                <li key={keyOf(f)} className="grid gap-0.5 text-[13.5px]">
                  <span>
                    <span
                      className={f.severity === "high" ? "font-semibold text-sev" : "font-semibold"}
                    >
                      {f.severity === "high" ? "High" : f.severity === "medium" ? "Medium" : "Low"}
                    </span>
                    {f.line ? <span className="mono text-mut"> line {f.line}</span> : null}
                    {": "}
                    {f.summary}
                  </span>
                  {f.detail ? <span className="text-[13px] text-mut">{f.detail}</span> : null}
                  {sessionId ? (
                    <span className="flex gap-2">
                      <button
                        type="button"
                        className="btn !min-h-7 !px-2 !text-[12.5px]"
                        aria-label={`Fix this one: ${f.summary}`}
                        onClick={() => fix([f])}
                      >
                        Fix this one
                      </button>
                      <button
                        type="button"
                        className="btn !min-h-7 !px-2 !text-[12.5px]"
                        aria-label={`Dismiss: ${f.summary}`}
                        onClick={() => void dismiss(f)}
                      >
                        Dismiss
                      </button>
                    </span>
                  ) : null}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

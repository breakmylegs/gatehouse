import { useContext, useState } from "react"
import { toast } from "sonner"
import { composeIn } from "../lib/compose"
import { startSide } from "../lib/side"
import { ReviewSession } from "./ReviewCard"

/**
 * T-076 (t3code review, O31): a review guide, a tour of the session's changes in the order to read them. Review guide,
 * in the Changes pane, asks a side session (Plan mode, the same folder, never Extreme approval: T-034) to write it as
 * a `codehouse-guide` block, which shows as this card: each stop with where to look and why, Look closely on the ones
 * that matter most, Ask about this stop (a question in the prompt box) and Finish review. The block is Claude's words,
 * so it is read only as data and drawn as text.
 */
export interface Stop {
  file: string
  lines?: string
  title: string
  why: string
  close?: boolean
}

export const GUIDE_FENCE = "codehouse-guide"

export const GUIDE_PROMPT = `Write a review guide for the changes made in this folder since its last commit and in its latest commits on this branch (git status, git diff and git log will show them). Change nothing. Give the stops in the order a reviewer should read them, starting with what the change is for, in one fenced block whose language is ${GUIDE_FENCE}, holding a JSON array of objects with "file" (relative path), "lines" (optional, such as "40-62"), "title" (a few words), "why" (what to look at and why, one or two sentences) and "close" (true for the stops that need the closest look).`

const MAX_STOPS = 60
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "")

/** The stops in a block, or undefined when it is not a guide (then it shows as plain code). */
export function parseGuide(block: string): Stop[] | undefined {
  let v: unknown
  try {
    v = JSON.parse(block)
  } catch {
    return undefined
  }
  const list = Array.isArray(v) ? v : (v as { stops?: unknown } | null)?.stops
  if (!Array.isArray(list)) return undefined
  const out: Stop[] = []
  for (const x of list.slice(0, MAX_STOPS)) {
    const o = (x ?? {}) as Record<string, unknown>
    const file = text(o.file, 300)
    const title = text(o.title, 120)
    const why = text(o.why, 1000)
    if (!file || !title || !why) continue
    const lines = /^\d{1,6}(-\d{1,6})?$/.test(text(o.lines, 20)) ? text(o.lines, 20) : undefined
    out.push({ file, title, why, ...(lines ? { lines } : {}), ...(o.close === true ? { close: true } : {}) })
  }
  return out.length ? out : undefined
}

/** Starts the side session that writes the guide. */
export const askForGuide = (sessionId: string) => startSide(sessionId, GUIDE_PROMPT)

export function GuideCard({ stops }: { stops: Stop[] }) {
  const sessionId = useContext(ReviewSession)
  const [at, setAt] = useState(0)
  const [done, setDone] = useState(false)
  const stop = stops[Math.min(at, stops.length - 1)]!
  if (done)
    return (
      <p role="status" className="panel m-0 p-3 text-[13.5px]">
        Review finished: {stops.length === 1 ? "1 stop" : `${stops.length} stops`} read.
      </p>
    )
  return (
    <section aria-label="Review guide" className="panel grid gap-2 p-3 text-[13.5px]">
      <strong>
        Review guide: stop {at + 1} of {stops.length}
      </strong>
      <ol className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label="Stops">
        {stops.map((s, i) => (
          <li key={i}>
            <button
              type="button"
              aria-current={i === at ? "step" : undefined}
              className="btn !min-h-7 !px-2 !text-[12px]"
              onClick={() => setAt(i)}
            >
              {i + 1}
              {s.close ? " (look closely)" : ""}
            </button>
          </li>
        ))}
      </ol>
      <div className="grid gap-1">
        <span className="font-semibold">
          {stop.title}
          {stop.close ? <span className="ml-2 text-warn">Look closely</span> : null}
        </span>
        <span className="mono text-xs text-mut">
          {stop.file}
          {stop.lines ? `, lines ${stop.lines}` : ""}
        </span>
        <span className="whitespace-pre-wrap">{stop.why}</span>
      </div>
      <span className="flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={at === 0} onClick={() => setAt(at - 1)}>
          Back
        </button>
        {at < stops.length - 1 ? (
          <button type="button" className="btn btn-primary" onClick={() => setAt(at + 1)}>
            Next stop
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setDone(true)}>
            Finish review
          </button>
        )}
        {sessionId ? (
          <button
            type="button"
            className="btn"
            onClick={() => {
              composeIn(sessionId, `About ${stop.file}${stop.lines ? `, lines ${stop.lines}` : ""} (${stop.title}): `)
              toast("A question about this stop is in the prompt box.", { id: "guide" })
            }}
          >
            Ask about this stop
          </button>
        ) : null}
      </span>
    </section>
  )
}

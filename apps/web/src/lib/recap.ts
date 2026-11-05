import { useEffect, useState } from "react"
import type { Item } from "./transcript"

/** How long you are away before a session says what happened (B14). */
export const AWAY_MS = 10 * 60_000

const EDITS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"])

const after = (at: number | undefined, since: number) => at !== undefined && at >= since

/** A file's name as the recap shows it: the path under the session's folder, or its own name. */
function shortName(file: string, cwd: string): string {
  const f = file.replace(/\\/g, "/")
  const c = cwd.replace(/\\/g, "/").replace(/\/$/, "")
  return f.toLowerCase().startsWith(`${c.toLowerCase()}/`)
    ? f.slice(c.length + 1)
    : (f.split("/").pop() ?? f)
}

const list = (names: string[]) =>
  names.length <= 3
    ? names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
    : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`

/**
 * What a session did while you were away, in up to five lines (B14): its turns, the files it changed, what you (or
 * the rules) decided for it, what waits for you, and whether it stopped. Nothing when nothing happened.
 */
export function recapOf(o: {
  since: number
  cwd: string
  items: Item[]
  decided: Array<{ outcome: string; at: string }>
  waiting: number
  state: string
  error?: string
}): string[] {
  const out: string[] = []
  const turns = o.items.filter((i) => i.kind === "result" && after(i.at, o.since)).length
  if (o.state === "running")
    out.push(
      turns
        ? `Claude finished ${turns === 1 ? "a turn" : `${turns} turns`} and is still working.`
        : "Claude is still working.",
    )
  else if (turns) out.push(`Claude finished ${turns === 1 ? "a turn" : `${turns} turns`}.`)
  const files = [
    ...new Set(
      o.items
        .filter(
          (i): i is Extract<Item, { kind: "tool" }> =>
            i.kind === "tool" &&
            EDITS.has(i.name) &&
            after(i.at, o.since) &&
            i.result?.isError !== true,
        )
        .map((i) => i.input.file_path ?? i.input.notebook_path)
        .filter((p): p is string => typeof p === "string")
        .map((p) => shortName(p, o.cwd)),
    ),
  ]
  if (files.length)
    out.push(`Changed ${files.length === 1 ? "1 file" : `${files.length} files`}: ${list(files)}.`)
  const decided = o.decided.filter((d) => Date.parse(d.at) >= o.since)
  if (decided.length) {
    const allowed = decided.filter((d) => d.outcome === "allow").length
    out.push(
      `${decided.length === 1 ? "1 request was decided" : `${decided.length} requests were decided`}: ${allowed} allowed, ${decided.length - allowed} not.`,
    )
  }
  if (o.waiting)
    out.push(
      o.waiting === 1
        ? "1 request is waiting for you."
        : `${o.waiting} requests are waiting for you.`,
    )
  if (o.state === "error")
    out.push(`It stopped${o.error ? `: ${o.error.trim().replace(/[.!]$/, "")}.` : "."}`)
  return out.slice(0, 5)
}

// When you went away: the window hidden or not in front. Kept in one place for every pane.
let leftAt: number | undefined
let awaySince: number | undefined
const listeners = new Set<() => void>()
const tell = () => listeners.forEach((l) => l())

function away() {
  leftAt ??= Date.now()
}
function back() {
  if (leftAt !== undefined && Date.now() - leftAt >= AWAY_MS) {
    awaySince = leftAt
    tell()
  }
  leftAt = undefined
}
if (typeof window !== "undefined") {
  window.addEventListener("blur", away)
  window.addEventListener("focus", back)
  document.addEventListener("visibilitychange", () =>
    document.visibilityState === "hidden" ? away() : back(),
  )
}

/** Since when you were away, once you are back after AWAY_MS or more; undefined otherwise. */
export function useAwaySince(): number | undefined {
  const [since, setSince] = useState(awaySince)
  useEffect(() => {
    const l = () => setSince(awaySince)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return since
}

/**
 * What was said while you were away, for Claude to sum up (owner, 4 Nov): your messages and Claude's own words, in
 * order, from the first thing that happened after you left. Subagents' own words and tool calls are left out.
 */
export function recapLines(
  items: Item[],
  since: number,
): Array<{ who: "you" | "claude"; text: string }> {
  const start = items.findIndex((i) => "at" in i && after(i.at, since))
  if (start < 0) return []
  const out: Array<{ who: "you" | "claude"; text: string }> = []
  for (const i of items.slice(start)) {
    if (i.kind === "user" && i.text.trim()) out.push({ who: "you", text: i.text })
    else if (i.kind === "text" && !i.subagent && i.text.trim())
      out.push({ who: "claude", text: i.text })
  }
  return out
}

/** Got it: the recaps go until you are away again. */
export function dismissRecap(): void {
  awaySince = undefined
  tell()
}

/** For tests: as if you left at `at` and came back now. */
export function _cameBack(at: number): void {
  leftAt = at
  back()
}

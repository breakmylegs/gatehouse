/**
 * D-084, an adversarial pair (Frontier build). The session that implemented a change is paired with a breaker: a second
 * model, the reviewer model in Settings (C-043), reached only through the model runtime or gateway on this computer and
 * within the data-boundary cards, in a worktree of its own holding a copy of the change. It has read tools and RunTests
 * (the project's own test command, as a Codehouse action) and nothing else; any edit it tries goes to a person (rule
 * breaker-edit), whatever the rules say. What it reports as findings is kept with the implementer's session and put in
 * that session's evidence pack (D-003).
 */
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export const BREAKER_EDIT_RULE = "breaker-edit"

export const breakerEditReason = (file: string) =>
  `A breaker tries to break a change, not to change it, so its edit to ${file || "a file"} goes to you, whatever the rules say.`

export const BREAKER_PROMPT = [
  "You are the breaker of an adversarial pair. This folder holds another model's change. Try to break it: read the change and the code around it, think of inputs and cases it gets wrong, and run the project's tests with RunTests.",
  "You cannot change files. Report each problem you find on its own line, starting with FINDING: and saying what breaks, where, and how you know (a test that failed, or the code that is wrong). Say NO FINDINGS if you found none.",
].join("\n")

export interface AdversaryRun {
  breaker: string
  model: string
  at: string
  findings: string[]
  /** Whether the breaker has reported yet. */
  reported: boolean
}

/** The findings in a breaker's reply: each line starting FINDING:, at most 50. */
export function breakerFindings(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => /^\s*[-*]?\s*FINDING:\s*(.+)$/i.exec(l)?.[1]?.trim())
    .filter((x): x is string => Boolean(x))
    .slice(0, 50)
    .map((x) => x.slice(0, 500))
}

/** Each implementer session's latest breaker run, while Codehouse runs. */
export class AdversaryStore {
  readonly #runs = new Map<string, AdversaryRun>()

  started(implementer: string, breaker: string, model: string, at = new Date()): void {
    this.#runs.set(implementer, { breaker, model, at: at.toISOString(), findings: [], reported: false })
  }

  reported(implementer: string, findings: string[]): void {
    const r = this.#runs.get(implementer)
    if (r) this.#runs.set(implementer, { ...r, findings, reported: true })
  }

  get(implementer: string): AdversaryRun | undefined {
    return this.#runs.get(implementer)
  }
}

/** D-084: the breaker's run for a session, for its evidence pack; nothing when it has none. */
export function adversaryOf(a: { adversary?: AdversaryStore }, id: string): { adversary?: { model: string; at: string; reported: boolean; findings: string[] } } {
  const r = a.adversary?.get(id)
  return r ? { adversary: { model: r.model, at: r.at, reported: r.reported, findings: r.findings } } : {}
}

/** Puts a change (a diff against HEAD) into another worktree of the same repository. */
export async function applyChange(diff: string, cwd: string): Promise<void> {
  if (!diff.trim()) return
  const file = path.join(os.tmpdir(), `codeh-breaker-${process.pid}-${Date.now().toString(36)}.patch`)
  fs.writeFileSync(file, diff.endsWith("\n") ? diff : `${diff}\n`)
  try {
    await new Promise<void>((resolve, reject) =>
      execFile("git", ["apply", "--whitespace=nowarn", file], { cwd, windowsHide: true, timeout: 60_000 }, (e, _o, err) =>
        e ? reject(new Error(String(err).trim() || e.message)) : resolve(),
      ),
    )
  } finally {
    fs.rmSync(file, { force: true })
  }
}

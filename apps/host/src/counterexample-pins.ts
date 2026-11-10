/**
 * D-008: the counterexamples one session's test runs found, and pinning one. Kept per session; shown on its pane as
 * proposals; pinned only when the owner chooses Pin on the desktop.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"
import {
  findCounterexamples,
  regressionFor,
  regressionPrompt,
  slugOf,
  type Counterexample,
} from "./counterexamples.js"
import type { HostAudit } from "./hostaudit.js"
import type { TestLocks } from "./test-locks.js"

export interface Proposal extends Counterexample {
  id: string
  /** Codehouse writes this one itself; otherwise Claude is asked to, or (a fuzz input) it is already written. */
  writesItself: boolean
}

export interface PinDeps {
  sessionId: string
  cwd: string
  project: string
  audit: Pick<HostAudit, "record">
  locks?: Pick<TestLocks, "lock">
  /** Sends Claude a message, for a regression Codehouse cannot write itself. */
  prompt: (text: string) => void
}

export class CounterexamplePins {
  readonly #d: PinDeps
  readonly #proposals = new Map<string, Proposal>()
  /** Files Claude was asked to write, by real path, and the counterexample each is for. */
  readonly #awaiting = new Map<string, Proposal>()

  constructor(d: PinDeps) {
    this.#d = d
  }

  list(): Proposal[] {
    return [...this.#proposals.values()]
  }

  /** Reads a shell command's output for counterexamples; true when it found one not seen before. */
  noteOutput(output: string): boolean {
    let added = false
    for (const c of findCounterexamples(output)) {
      const seen = [...this.#proposals.values()].some(
        (p) => p.framework === c.framework && p.example === c.example && p.test === c.test,
      )
      if (seen || this.#proposals.size >= 20) continue
      const id = crypto.randomBytes(6).toString("hex")
      this.#proposals.set(id, { ...c, id, writesItself: c.framework !== "fscheck" })
      added = true
    }
    return added
  }

  dismiss(id: string): void {
    this.#proposals.delete(id)
  }

  async #record(p: Proposal, file: string, by: "codehouse" | "claude" | "fuzz-input"): Promise<void> {
    const written = await this.#d.audit
      .record({
        session: this.#d.sessionId,
        event: "counterexample_pinned",
        channel: by === "claude" ? "host" : "desktop",
        tool: "counterexamples",
        cwd: this.#d.cwd,
        project: this.#d.project,
        input: { framework: p.framework, ...(p.test ? { test: p.test } : {}), example: p.example, file, by },
        verdict: {
          outcome: "allow",
          ruleId: "counterexample-pin",
          reason: "A counterexample was pinned as a locked regression test.",
          risk: 0,
          decidedBy: by === "claude" ? "rules" : "human-desktop",
          policyHash: "",
        },
        latencyMs: 0,
      })
      .catch(() => false)
    if (!written) throw new Error("The pin could not be recorded in the audit log, so the test was not written.")
  }

  /**
   * Pins a proposal. Written by Codehouse where it can (recorded first, then written, then locked); a fuzz input is
   * locked as it is; otherwise Claude is asked to write the test, and the file is locked when it has.
   */
  async pin(id: string): Promise<{ file: string; by: "codehouse" | "claude" | "fuzz-input" }> {
    const p = this.#proposals.get(id)
    if (!p) throw new Error("That counterexample is no longer here.")
    const cwd = this.#d.cwd
    if (p.framework === "fuzz") {
      const file = path.relative(cwd, path.resolve(cwd, p.example)).replace(/\\/g, "/")
      await this.#record(p, file, "fuzz-input")
      await this.#d.locks?.lock(cwd, file)
      this.#proposals.delete(id)
      return { file, by: "fuzz-input" }
    }
    const testFile = p.file ? path.resolve(cwd, p.file) : undefined
    const source = testFile && fs.existsSync(testFile) ? fs.readFileSync(testFile, "utf8") : undefined
    const reg = source !== undefined ? regressionFor(p, source) : undefined
    if (reg && testFile) {
      const target = path.join(path.dirname(testFile), reg.file)
      if (fs.existsSync(target)) throw new Error(`A regression test is already at ${reg.file}.`)
      const file = path.relative(cwd, target).replace(/\\/g, "/")
      await this.#record(p, file, "codehouse")
      await writeFileAtomic(target, reg.content)
      await this.#d.locks?.lock(cwd, file)
      this.#proposals.delete(id)
      return { file, by: "codehouse" }
    }
    // Claude writes it; Codehouse locks it once it has.
    const ext = p.framework === "fscheck" ? ".cs" : p.framework === "hypothesis" ? ".py" : ".test.ts"
    const dir = testFile ? path.dirname(testFile) : path.join(cwd, "tests")
    const target = path.join(dir, `Regression_${slugOf(p.example).replace(/-/g, "_")}${ext}`)
    const file = path.relative(cwd, target).replace(/\\/g, "/")
    this.#awaiting.set(path.resolve(target).toLowerCase(), p)
    this.#proposals.delete(id)
    this.#d.prompt(regressionPrompt(p, file))
    return { file, by: "claude" }
  }

  /** After Claude wrote a file: if it was a regression it was asked for, it is recorded and locked. */
  async noteWritten(file: string): Promise<boolean> {
    const key = path.resolve(this.#d.cwd, file).toLowerCase()
    const p = this.#awaiting.get(key)
    if (!p) return false
    this.#awaiting.delete(key)
    const rel = path.relative(this.#d.cwd, path.resolve(this.#d.cwd, file)).replace(/\\/g, "/")
    await this.#record(p, rel, "claude")
    await this.#d.locks?.lock(this.#d.cwd, rel)
    return true
  }
}

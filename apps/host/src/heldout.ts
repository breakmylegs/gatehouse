/**
 * D-002, sealed held-out checks (Frontier build, Wave 1). Tests the owner adds for a project, from the desktop only,
 * that no session ever sees: sealed with DPAPI for this Windows user under %LOCALAPPDATA%\Gatehouse\sealed\<project>\,
 * a folder the floor denies to every tool in every mode (BUILTIN_FLOOR, rule sealed-checks).
 *
 * A run unseals them into a fresh folder under %LOCALAPPDATA%\Gatehouse\heldout-runs\ (outside every worktree, and
 * denied at the floor too), runs the project's own test command on them in the project's folder, under a job object
 * where one can be had, and removes the folder afterwards without following any link out of it. Only the counts
 * (passed, failed, total) leave this module for a session; the names and the output are for the desktop's detail
 * view alone, and are never logged, audited, sent to the phone or a push channel.
 */
import { spawn, type ChildProcess } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"
import type { Protector } from "./relay/protector.js"

export interface HeldOutCounts {
  passed: number
  failed: number
  total: number
}

export interface HeldOutResult {
  /** What the session may know. Undefined counts when the output gave none; then only whether it passed. */
  counts?: HeldOutCounts
  ok: boolean
  exitCode: number | null
  timedOut: boolean
  ms: number
}

/** For the desktop's detail view only. */
export interface HeldOutDetail extends HeldOutResult {
  names: string[]
  output: string
}

export class HeldOutError extends Error {}

/** A project's key: its folder name in lower case, letters, digits, dot, dash and underscore only. */
export function projectKey(project: string): string {
  const k = project.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[.-]+/, "")
  if (!k) throw new HeldOutError("That project has no name Codehouse can keep checks under.")
  return k.slice(0, 80)
}

/** A test file's name: one plain file name, kept as given so the test runner finds it. */
export function checkName(name: string): string {
  const n = name.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$/.test(n) || n.includes(".."))
    throw new HeldOutError("Give the test file a plain name, such as test_hidden.py or hidden.test.ts.")
  return n
}

/** The counts in a test runner's summary: vitest, jest, pytest, mocha, dotnet test, Pester or go test. */
export function countsOf(output: string): HeldOutCounts | undefined {
  // Codes for colour are taken out first.
  const t = output.replace(/\u001b\[[0-9;]*m/g, "")
  const num = (re: RegExp) => {
    const m = re.exec(t)
    return m ? Number(m[1]) : undefined
  }
  // vitest: "Tests  2 failed | 5 passed (7)"; jest: "Tests: 2 failed, 5 passed, 7 total"
  const vt = /Tests\s*:?\s+(?:(\d+) failed[ ,|]+)?(?:(\d+) passed)?[^\n(]*\((\d+)\)/.exec(t)
  if (vt && vt[3]) {
    const failed = Number(vt[1] ?? 0)
    const total = Number(vt[3])
    return { failed, passed: Number(vt[2] ?? total - failed), total }
  }
  const jt = num(/Tests:\s+[^\n]*?(\d+) total/)
  if (jt !== undefined) {
    const failed = num(/Tests:\s+[^\n]*?(\d+) failed/) ?? 0
    const passed = num(/Tests:\s+[^\n]*?(\d+) passed/) ?? 0
    return { failed, passed, total: jt }
  }
  // dotnet test: "Failed!  - Failed:     1, Passed:     3, Skipped: 0, Total:     4"
  const dt = /Failed:\s+(\d+),\s+Passed:\s+(\d+),\s+Skipped:\s+\d+,\s+Total:\s+(\d+)/.exec(t)
  if (dt) return { failed: Number(dt[1]), passed: Number(dt[2]), total: Number(dt[3]) }
  // Pester: "Tests Passed: 3, Failed: 1, Skipped: 0"
  const pe = /Tests Passed:\s*(\d+),\s*Failed:\s*(\d+)/.exec(t)
  if (pe) {
    const passed = Number(pe[1])
    const failed = Number(pe[2])
    return { passed, failed, total: passed + failed }
  }
  // pytest: "=== 1 failed, 3 passed in 0.12s ===" (either may be missing); mocha: "3 passing", "1 failing"
  const pyPassed = num(/(\d+) passed(?: in|,| ==)/)
  const pyFailed = num(/(\d+) failed(?: in|,| ==)/)
  if (pyPassed !== undefined || pyFailed !== undefined)
    return { passed: pyPassed ?? 0, failed: pyFailed ?? 0, total: (pyPassed ?? 0) + (pyFailed ?? 0) }
  const moPassed = num(/(\d+) passing/)
  if (moPassed !== undefined) {
    const failed = num(/(\d+) failing/) ?? 0
    return { passed: moPassed, failed, total: moPassed + failed }
  }
  return undefined
}

/**
 * Removes a folder and what is in it without following a link or junction out of it: a link is removed as a link,
 * never walked into.
 */
export function removeTreeNoFollow(dir: string): void {
  let st: fs.Stats
  try {
    st = fs.lstatSync(dir)
  } catch {
    return
  }
  if (st.isSymbolicLink() || !st.isDirectory()) {
    fs.rmSync(dir, { force: true })
    return
  }
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const s = fs.lstatSync(p)
    if (s.isSymbolicLink()) {
      // A junction or link: unlinked, its target left alone.
      try {
        fs.unlinkSync(p)
      } catch {
        fs.rmdirSync(p)
      }
    } else if (s.isDirectory()) removeTreeNoFollow(p)
    else fs.rmSync(p, { force: true })
  }
  fs.rmdirSync(dir)
}

interface Index {
  version: 1
  /** The project's test command, with {dir} where the folder of unsealed tests goes. */
  command?: string
  checks: Array<{ id: string; name: string }>
}

export interface HeldOutDeps {
  dataDir: string
  sealer: () => Protector
  /** Runs a command under a job object where one can be had. Absent: a plain child process (tests). */
  spawnLimited?: (command: string, cwd: string) => ChildProcess
  /** The longest a run may take. */
  timeoutMs?: number
}

export class HeldOutChecks {
  readonly #d: HeldOutDeps

  constructor(d: HeldOutDeps) {
    this.#d = d
  }

  get sealedRoot(): string {
    return path.join(this.#d.dataDir, "sealed")
  }

  get runsRoot(): string {
    return path.join(this.#d.dataDir, "heldout-runs")
  }

  #dir(project: string): string {
    return path.join(this.sealedRoot, projectKey(project))
  }

  /** The index, itself sealed, so the names of the checks are as hidden as the checks. */
  async #index(project: string): Promise<Index> {
    const file = path.join(this.#dir(project), "index.sealed")
    if (!fs.existsSync(file)) return { version: 1, checks: [] }
    const bytes = await this.#d.sealer().unprotect(fs.readFileSync(file))
    const raw = JSON.parse(Buffer.from(bytes).toString("utf8")) as Partial<Index>
    return { ...raw, version: 1, checks: Array.isArray(raw.checks) ? raw.checks : [] }
  }

  async #saveIndex(project: string, index: Index): Promise<void> {
    const dir = this.#dir(project)
    fs.mkdirSync(dir, { recursive: true })
    const sealed = await this.#d.sealer().protect(Buffer.from(JSON.stringify(index), "utf8"))
    await writeFileAtomic(path.join(dir, "index.sealed"), Buffer.from(sealed))
  }

  /** How many checks a project has, and whether it has a command: what any screen may show. */
  async summary(project: string): Promise<{ count: number; command: boolean }> {
    try {
      const i = await this.#index(project)
      return { count: i.checks.length, command: Boolean(i.command) }
    } catch {
      return { count: 0, command: false }
    }
  }

  /** The names and the command, for the desktop only. */
  async list(project: string): Promise<{ names: string[]; command?: string }> {
    const i = await this.#index(project)
    return { names: i.checks.map((c) => c.name), ...(i.command ? { command: i.command } : {}) }
  }

  async setCommand(project: string, command: string): Promise<void> {
    const c = command.trim()
    if (!c.includes("{dir}"))
      throw new HeldOutError("Put {dir} in the command where the folder of held-out tests goes, such as npx vitest run {dir}.")
    if (c.length > 500 || /[\r\n]/.test(c)) throw new HeldOutError("Give the command on one line.")
    const i = await this.#index(project)
    await this.#saveIndex(project, { ...i, command: c })
  }

  async add(project: string, name: string, content: string): Promise<void> {
    const n = checkName(name)
    if (Buffer.byteLength(content, "utf8") > 1_000_000) throw new HeldOutError("A held-out test must be under 1 MB.")
    const i = await this.#index(project)
    if (i.checks.some((c) => c.name.toLowerCase() === n.toLowerCase()))
      throw new HeldOutError("This project already has a held-out test of that name.")
    const id = crypto.randomBytes(8).toString("hex")
    fs.mkdirSync(this.#dir(project), { recursive: true })
    const sealed = await this.#d.sealer().protect(Buffer.from(content, "utf8"))
    await writeFileAtomic(path.join(this.#dir(project), `${id}.sealed`), Buffer.from(sealed))
    await this.#saveIndex(project, { ...i, checks: [...i.checks, { id, name: n }] })
  }

  async remove(project: string, name: string): Promise<void> {
    const i = await this.#index(project)
    const c = i.checks.find((x) => x.name === name)
    if (!c) return
    fs.rmSync(path.join(this.#dir(project), `${c.id}.sealed`), { force: true })
    await this.#saveIndex(project, { ...i, checks: i.checks.filter((x) => x !== c) })
  }

  /** Runs the checks in the project's folder. The detail is the desktop's; give a session only `result.counts`. */
  async run(project: string, cwd: string): Promise<HeldOutDetail> {
    const i = await this.#index(project)
    if (!i.checks.length) throw new HeldOutError("This project has no held-out tests yet.")
    if (!i.command) throw new HeldOutError("Set the command that runs this project's held-out tests first.")
    const runDir = path.join(this.runsRoot, crypto.randomBytes(8).toString("hex"))
    fs.mkdirSync(runDir, { recursive: true })
    const began = Date.now()
    try {
      for (const c of i.checks) {
        const bytes = await this.#d.sealer().unprotect(fs.readFileSync(path.join(this.#dir(project), `${c.id}.sealed`)))
        fs.writeFileSync(path.join(runDir, c.name), Buffer.from(bytes))
      }
      const command = i.command.replaceAll("{dir}", `"${runDir}"`)
      const child = this.#d.spawnLimited
        ? this.#d.spawnLimited(command, cwd)
        : spawn(command, { cwd, shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
      let output = ""
      const keep = (d: Buffer) => {
        if (output.length < 400_000) output += d.toString("utf8")
      }
      child.stdout?.on("data", keep)
      child.stderr?.on("data", keep)
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        child.kill()
      }, this.#d.timeoutMs ?? 10 * 60_000)
      const exitCode = await new Promise<number | null>((resolve) => {
        child.on("close", (code) => resolve(code))
        child.on("error", () => resolve(null))
      })
      clearTimeout(timer)
      const counts = countsOf(output)
      return {
        ...(counts ? { counts } : {}),
        ok: exitCode === 0 && !timedOut && (counts ? counts.failed === 0 : true),
        exitCode,
        timedOut,
        ms: Date.now() - began,
        names: i.checks.map((c) => c.name),
        output,
      }
    } finally {
      removeTreeNoFollow(runDir)
    }
  }
}

/** What a session is told: the counts, and nothing else. */
export function countsLine(r: HeldOutResult): string {
  if (r.timedOut) return "Held-out checks: the run did not finish in time."
  if (!r.counts) return `Held-out checks: ${r.ok ? "passed" : "failed"} (the runner gave no counts).`
  const { passed, failed, total } = r.counts
  return `Held-out checks: ${passed} passed, ${failed} failed, of ${total}.`
}

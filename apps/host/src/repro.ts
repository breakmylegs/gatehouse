/**
 * E-043, verified reproduction recipes (Expansion E4). From a bug's description Claude writes a minimal test that
 * reproduces it, without fixing the bug yet. Codehouse runs the test as a Codehouse action and accepts it only when it
 * fails: a reproduction that passes before the fix does not reproduce the bug, and is rejected. Its contents are noted
 * when it fails; after the fix it must still be the same test, it must pass, and it is then locked (D-007), so the bug
 * cannot come back unnoticed and the test cannot be weakened to hide it.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export interface Repro {
  file: string
  command: string
  bug: string
  stage: "failed-before" | "verified"
  /** The test's contents when it failed, hashed. */
  hash: string
  at: string
}

export type ReproRun = (command: string, cwd: string) => Promise<{ ran: boolean; exitCode: number | null; output: string; refused?: string }>

/** The prompt that asks Claude for the reproduction. */
export const reproPrompt = (bug: string) =>
  [
    "Write a minimal automated test that reproduces this bug, in the project's own test framework. Do not fix the bug yet: the test must fail now, for the reason the bug describes.",
    `The bug: ${bug.trim()}`,
    "Keep it to the smallest case that shows the bug. When it is written, say the test file's path and the command that runs only that test.",
  ].join("\n\n")

const hashOf = (abs: string) => crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex")

const inside = (root: string, file: string): string | undefined => {
  const abs = path.resolve(root, file)
  const rel = path.relative(root, abs)
  return rel.startsWith("..") || path.isAbsolute(rel) ? undefined : abs
}

/** Each project's reproductions, in the data folder. */
export class ReproStore {
  constructor(readonly file: string) {}
  read(project: string): Repro[] {
    try {
      const v = JSON.parse(fs.readFileSync(this.file, "utf8")) as { projects?: Record<string, Repro[]> }
      return v.projects?.[project.toLowerCase()] ?? []
    } catch {
      return []
    }
  }
  #save(project: string, list: Repro[]): void {
    let all: Record<string, Repro[]> = {}
    try {
      all = (JSON.parse(fs.readFileSync(this.file, "utf8")) as { projects?: Record<string, Repro[]> }).projects ?? {}
    } catch {
      // A first write.
    }
    all[project.toLowerCase()] = list.slice(-100)
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify({ v: 1, projects: all }, null, 1))
    fs.renameSync(`${this.file}.tmp`, this.file)
  }
  put(project: string, r: Repro): void {
    this.#save(project, [...this.read(project).filter((x) => x.file !== r.file), r])
  }
}

export type ReproOutcome = { ok: true; repro: Repro; message: string } | { ok: false; message: string }

/** Before the fix: the test must fail. A pass is rejected. */
export async function confirmFails(root: string, file: string, command: string, bug: string, run: ReproRun, store: ReproStore): Promise<ReproOutcome> {
  const abs = inside(root, file)
  if (!abs || !fs.existsSync(abs)) return { ok: false, message: "The test must be a file in the project, and it is not there." }
  const r = await run(command, root)
  if (!r.ran) return { ok: false, message: `It was not run: ${r.refused ?? "refused"}.` }
  if (r.exitCode === 0) return { ok: false, message: "Rejected: the test passes before the fix, so it does not reproduce the bug. Ask Claude to make it fail for the reason the bug describes." }
  const repro: Repro = { file: path.relative(root, abs).replace(/\\/g, "/"), command, bug: bug.slice(0, 2000), stage: "failed-before", hash: hashOf(abs), at: new Date().toISOString() }
  store.put(root, repro)
  return { ok: true, repro, message: `It fails before the fix (exit ${r.exitCode}), so it reproduces the bug. Fix the bug, then confirm it passes.` }
}

/** After the fix: the same test must pass; it is then locked. */
export async function confirmPasses(root: string, file: string, run: ReproRun, store: ReproStore, lock: (file: string) => Promise<void>): Promise<ReproOutcome> {
  const known = store.read(root).find((x) => x.file === file.replace(/\\/g, "/"))
  if (!known) return { ok: false, message: "Confirm the test fails before the fix first." }
  const abs = inside(root, known.file)
  if (!abs || !fs.existsSync(abs)) return { ok: false, message: "The test is not there any more." }
  if (hashOf(abs) !== known.hash) return { ok: false, message: "Rejected: the test was changed after it failed, so a pass now proves nothing. Put it back as it was when it failed, or start again." }
  const r = await run(known.command, root)
  if (!r.ran) return { ok: false, message: `It was not run: ${r.refused ?? "refused"}.` }
  if (r.exitCode !== 0) return { ok: false, message: `It still fails (exit ${r.exitCode}), so the bug is not fixed yet.` }
  await lock(known.file)
  const repro: Repro = { ...known, stage: "verified", at: new Date().toISOString() }
  store.put(root, repro)
  return { ok: true, repro, message: "It failed before the fix and passes after it. The test is now locked." }
}

/**
 * D-059, instruction integrity pinning (Frontier build, Wave 1). What a project tells an agent (CLAUDE.md, AGENTS.md,
 * Claude's settings, skills, commands and agent files) is pinned by hash in a pin file per project under the data
 * folder (%LOCALAPPDATA%\Gatehouse\instruction-pins\), never in the repository, with a copy of each file as pinned so
 * a change can be shown as a diff.
 *
 * An agent's edit of one escalates as instructions-edit, which Extreme approval never approves, and once a person
 * approves it the file is pinned again as it now is. A change made outside Codehouse (a pull, another editor, a
 * checkout) stops the next session start and the next turn until the owner reads the diff on the desktop and approves
 * it. The pin file carries an HMAC made with a key sealed for this Windows user (DPAPI): edited, or unreadable, it
 * means a review. A project seen for the first time is pinned as it is (there is nothing earlier to compare with).
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"
import type { HostAudit } from "./hostaudit.js"
import type { Protector } from "./relay/protector.js"
import { changedByShell, realDir, realPath, TestLocks } from "./test-locks.js"

export const INSTRUCTIONS_RULE = "instructions-edit"

export class InstructionsChangedError extends Error {
  constructor(readonly files: string[]) {
    super(
      `What this project tells Claude changed outside Codehouse (${files.slice(0, 3).join(", ")}${files.length > 3 ? ` and ${files.length - 3} more` : ""}). Read the change and approve it on the desktop first.`,
    )
  }
}

/** Files at the project's root, and folders under .claude, that tell an agent what to do. */
const ROOT_FILES = ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", ".claude/CLAUDE.md", ".claude/settings.json", ".claude/settings.local.json"]
const DIRS = [".claude/skills", ".claude/commands", ".claude/agents"]
const MAX_FILES = 500
/** A copy kept for the diff only when the file is this small; a larger one is still pinned by its hash. */
const MAX_COPY = 256 * 1024

/** Whether a path inside the project (forward slashes) is one of them. CLAUDE.md and AGENTS.md count in any folder. */
export function isInstructionFile(relPath: string): boolean {
  const r = relPath.replace(/\\/g, "/").toLowerCase()
  if (r.startsWith("../") || r.includes("/node_modules/") || r.startsWith("node_modules/")) return false
  const base = r.split("/").pop() ?? ""
  if (base === "claude.md" || base === "claude.local.md" || base === "agents.md") return true
  if (ROOT_FILES.some((f) => f.toLowerCase() === r)) return true
  return DIRS.some((d) => r.startsWith(`${d.toLowerCase()}/`))
}

interface PinFile {
  version: 1
  files: Record<string, string>
  mac: string
}

export interface InstructionChange {
  path: string
  kind: "changed" | "added" | "removed"
  /** The lines, each starting with "+", "-" or " ", when both sides could be read; absent for one too large. */
  diff?: string[]
}

export interface InstructionState {
  changes: InstructionChange[]
  /** The pin file does not match its seal, or cannot be read: everything is shown for review. */
  unreadable: boolean
}

const hashOf = (buf: Buffer) => crypto.createHash("sha256").update(buf).digest("hex")
const hashes = (m: Map<string, Buffer>) => Object.fromEntries([...m].map(([rel, buf]) => [rel, hashOf(buf)]))

/** A line diff: a longest common subsequence, for files of up to 2,000 lines a side; past that, all out and all in. */
export function lineDiff(before: string, after: string): string[] {
  const a = before.split(/\r?\n/)
  const b = after.split(/\r?\n/)
  if (a.length > 2000 || b.length > 2000) return [...a.map((l) => `-${l}`), ...b.map((l) => `+${l}`)]
  const n = a.length
  const m = b.length
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(` ${a[i]}`)
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push(`-${a[i++]}`)
    else out.push(`+${b[j++]}`)
  }
  while (i < n) out.push(`-${a[i++]}`)
  while (j < m) out.push(`+${b[j++]}`)
  return out
}

export interface InstructionPinsDeps {
  dir: string
  sealer: () => Protector
}

export class InstructionPins {
  readonly #d: InstructionPinsDeps
  #key: Buffer | undefined

  constructor(d: InstructionPinsDeps) {
    this.#d = d
  }

  async #macKey(): Promise<Buffer> {
    if (this.#key) return this.#key
    const file = path.join(this.#d.dir, "key.sealed")
    if (fs.existsSync(file)) this.#key = Buffer.from(await this.#d.sealer().unprotect(fs.readFileSync(file)))
    else {
      const key = crypto.randomBytes(32)
      fs.mkdirSync(this.#d.dir, { recursive: true })
      await writeFileAtomic(file, Buffer.from(await this.#d.sealer().protect(key)))
      this.#key = key
    }
    return this.#key
  }

  async #mac(files: Record<string, string>): Promise<string> {
    const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
    return crypto.createHmac("sha256", await this.#macKey()).update(JSON.stringify(sorted)).digest("hex")
  }

  #folder(root: string): string {
    const key = crypto.createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 16)
    return path.join(this.#d.dir, `${path.basename(root).toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}-${key}`)
  }

  /** The instruction files of the project as they are now, by path from its root, with their bytes. */
  #now(root: string): Map<string, Buffer> {
    const out = new Map<string, Buffer>()
    const add = (rel: string) => {
      if (out.size >= MAX_FILES) return
      try {
        const abs = path.join(root, rel)
        const st = fs.lstatSync(abs)
        if (st.isFile()) out.set(rel, fs.readFileSync(abs))
      } catch {
        // not there
      }
    }
    for (const f of ROOT_FILES) add(f)
    for (const d of DIRS) {
      try {
        for (const e of fs.readdirSync(path.join(root, d), { recursive: true, withFileTypes: true }))
          if (e.isFile()) add(path.relative(root, path.join(e.parentPath, e.name)).replace(/\\/g, "/"))
      } catch {
        // no such folder
      }
    }
    return out
  }

  /** The pins, or undefined when there is no pin file yet; unreadable when it is there but does not match its seal. */
  async #read(root: string): Promise<{ files: Record<string, string>; unreadable: boolean } | undefined> {
    const file = path.join(this.#folder(root), "pins.json")
    if (!fs.existsSync(file)) return undefined
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PinFile>
      const files = raw.files && typeof raw.files === "object" ? (raw.files as Record<string, string>) : {}
      return { files, unreadable: !(typeof raw.mac === "string" && raw.mac === (await this.#mac(files))) }
    } catch {
      return { files: {}, unreadable: true }
    }
  }

  /** Pins `files` (path to hash), keeping a copy of each small new version in `bytes` for later diffs. */
  async #write(root: string, files: Record<string, string>, bytes: Map<string, Buffer>): Promise<void> {
    const folder = this.#folder(root)
    fs.mkdirSync(path.join(folder, "copies"), { recursive: true })
    for (const buf of bytes.values()) {
      const copy = path.join(folder, "copies", hashOf(buf))
      if (buf.length <= MAX_COPY && !fs.existsSync(copy)) await writeFileAtomic(copy, buf)
    }
    const body: PinFile = { version: 1, files, mac: await this.#mac(files) }
    await writeFileAtomic(path.join(folder, "pins.json"), JSON.stringify(body, null, 2) + "\n")
  }

  /** The copy of a pinned version, when it was kept and is still what was pinned. */
  #copy(root: string, hash: string): string | undefined {
    try {
      const buf = fs.readFileSync(path.join(this.#folder(root), "copies", hash))
      return hashOf(buf) === hash ? buf.toString("utf8") : undefined
    } catch {
      return undefined
    }
  }

  /** What changed since the pins, with a diff for each. A project seen for the first time is pinned, and nothing changed. */
  async state(cwd: string): Promise<InstructionState> {
    const root = TestLocks.rootOf(cwd)
    const now = this.#now(root)
    const pins = await this.#read(root)
    if (!pins) {
      await this.#write(root, hashes(now), now)
      return { changes: [], unreadable: false }
    }
    const changes: InstructionChange[] = []
    const text = (b: Buffer) => (b.length <= MAX_COPY ? b.toString("utf8") : undefined)
    for (const [rel, buf] of now) {
      const was = pins.unreadable ? undefined : pins.files[rel]
      if (was === hashOf(buf)) continue
      const before = was ? this.#copy(root, was) : ""
      const after = text(buf)
      changes.push({
        path: rel,
        kind: was ? "changed" : "added",
        ...(before !== undefined && after !== undefined ? { diff: lineDiff(before, after) } : {}),
      })
    }
    for (const [rel, h] of Object.entries(pins.files))
      if (!now.has(rel)) {
        const before = this.#copy(root, h)
        changes.push({ path: rel, kind: "removed", ...(before !== undefined ? { diff: lineDiff(before, "") } : {}) })
      }
    // An unreadable pin file with nothing on disk is still a review: the record of what was pinned is gone.
    if (pins.unreadable && !changes.length) changes.push({ path: "the pin file", kind: "changed" })
    return { changes, unreadable: pins.unreadable }
  }

  /** The files changed outside Codehouse since they were pinned. */
  async changedOutside(cwd: string): Promise<string[]> {
    return (await this.state(cwd)).changes.map((c) => c.path)
  }

  /** The owner read the change on the desktop and approves the files as they now are. */
  async approve(cwd: string): Promise<string[]> {
    const root = TestLocks.rootOf(cwd)
    const changed = await this.changedOutside(cwd)
    const now = this.#now(root)
    await this.#write(root, hashes(now), now)
    return changed
  }

  /**
   * An agent's change a person approved: these files are pinned again as they now are (or let go, when deleted), the
   * rest stay as pinned. With the pin file unreadable nothing is pinned, so the owner still reviews it.
   */
  async repin(cwd: string, only: string[]): Promise<void> {
    const root = TestLocks.rootOf(cwd)
    const pins = await this.#read(root)
    if (pins?.unreadable) return
    const now = this.#now(root)
    const files = { ...(pins?.files ?? {}) }
    const bytes = new Map<string, Buffer>()
    for (const rel of only) {
      const buf = now.get(rel)
      if (buf) {
        files[rel] = hashOf(buf)
        bytes.set(rel, buf)
      } else delete files[rel]
    }
    await this.#write(root, files, bytes)
  }

  /** The instruction files a call would change: a file tool's target, or one a shell command writes or names to change. */
  touched(cwd: string, tool: string, input: Record<string, unknown>): string[] {
    const root = TestLocks.rootOf(cwd)
    const relOf = (abs: string) => path.relative(root, abs).replace(/\\/g, "/")
    const is = (abs: string) => isInstructionFile(relOf(abs))
    if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
      const f = typeof input.file_path === "string" ? input.file_path : input.notebook_path
      if (typeof f !== "string") return []
      const abs = realPath(path.resolve(realDir(cwd), f))
      return is(abs) ? [relOf(abs)] : []
    }
    if (tool !== "Bash" && tool !== "PowerShell") return []
    return changedByShell(typeof input.command === "string" ? input.command : "", cwd, is).map(relOf)
  }
}

/**
 * You read the change on the desktop and approve it: recorded as instructions_approved first, and the pins move only
 * when it was. False when it could not be recorded (nothing is approved then).
 */
export async function approveInstructions(pins: InstructionPins, audit: Pick<HostAudit, "record">, cwd: string): Promise<boolean> {
  const files = await pins.changedOutside(cwd)
  const written = await audit.record({
    session: "desktop",
    event: "instructions_approved",
    channel: "desktop",
    tool: "instructions",
    cwd,
    input: { files },
    verdict: {
      outcome: "allow",
      ruleId: INSTRUCTIONS_RULE,
      reason: "You read the change to what this project tells Claude and approved it.",
      risk: 0,
      decidedBy: "human-desktop",
      policyHash: "",
    },
    latencyMs: 0,
  })
  if (!written) return false
  await pins.approve(cwd)
  return true
}

export const instructionsReason = (files: string[]) =>
  `It would change ${files[0]}${files.length > 1 ? ` and ${files.length - 1} more` : ""}, which tells Claude what to do in this project. Changes to the instructions are yours to approve, even in Extreme approval, and the card shows the change.`

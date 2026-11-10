/**
 * D-007, locked acceptance tests (Frontier build, Wave 1). Test files the owner locks on the desktop are pinned by
 * their hash in a lock file per project under the data folder (%LOCALAPPDATA%\Gatehouse\locks\), never in the
 * repository, and denied to sessions at the floor (BUILTIN_FLOOR). An agent's edit, rename or delete of a locked test
 * escalates as locked-test, which Extreme approval never approves.
 *
 * The lock file carries an HMAC made with a key sealed for this Windows user (DPAPI). Edited outside Codehouse, it no
 * longer matches, and then every test file of the project counts as locked (fail closed). A locked test changed
 * outside Codehouse (a pull, another editor) stops the next session from starting until the owner accepts the new
 * version; one changed through Codehouse with the owner's approval is pinned again by itself.
 *
 * Whole files only for now: locking one case within a file needs the code outline (C-031) to find where the case
 * begins and ends.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { findProjectRoot, isTestFile } from "@gatehouse/policy"
import { writeFileAtomic } from "@gatehouse/shared/node"
import type { Protector } from "./relay/protector.js"

export const LOCKED_TEST_RULE = "locked-test"

export class TestLockError extends Error {}

interface LockFile {
  version: 1
  /** Paths relative to the project's root, with forward slashes, and the SHA-256 of each file as pinned. */
  files: Record<string, string>
  mac: string
}

export interface LockState {
  files: Array<{ path: string; changed: boolean; missing: boolean }>
  /** The lock file does not match its seal: every test file counts as locked. */
  tampered: boolean
}

const rel = (root: string, p: string) => path.relative(root, p).replace(/\\/g, "/")
const hashOf = (file: string): string | undefined => {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
  } catch {
    return undefined
  }
}

/** Commands that only read or run a file, so naming a locked test in them changes nothing. */
const READ_ONLY = new Set([
  "cat", "type", "head", "tail", "less", "more", "grep", "rg", "findstr", "wc", "diff", "fc",
  "get-content", "gc", "select-string", "sls", "measure-object", "test-path",
  "vitest", "jest", "mocha", "pytest", "invoke-pester",
])
const READ_ONLY_PAIRS = /^(git (diff|log|show|blame|status)|npm (test|run test)|npx (vitest|jest|mocha)|dotnet test|go test)\b/i

/** The words of each command of a shell line, quotes taken off; good enough to tell what a command names. */
function commandsOf(line: string): string[][] {
  const out: string[][] = []
  for (const part of line.split(/&&|\|\||[;|\n]/)) {
    const words = [...part.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "")
    if (words.length) out.push(words)
  }
  return out
}

export interface TestLocksDeps {
  dir: string
  sealer: () => Protector
}

export class TestLocks {
  readonly #d: TestLocksDeps
  #key: Buffer | undefined

  constructor(d: TestLocksDeps) {
    this.#d = d
  }

  async #macKey(): Promise<Buffer> {
    if (this.#key) return this.#key
    const file = path.join(this.#d.dir, "key.sealed")
    if (fs.existsSync(file)) {
      this.#key = Buffer.from(await this.#d.sealer().unprotect(fs.readFileSync(file)))
    } else {
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

  #file(root: string): string {
    const key = crypto.createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 16)
    return path.join(this.#d.dir, `${path.basename(root).toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}-${key}.json`)
  }

  /** The pins, and whether the file still matches its seal. No lock file: nothing locked, and nothing tampered. */
  async #read(root: string): Promise<{ files: Record<string, string>; tampered: boolean }> {
    const file = this.#file(root)
    if (!fs.existsSync(file)) return { files: {}, tampered: false }
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<LockFile>
      const files = raw.files && typeof raw.files === "object" ? (raw.files as Record<string, string>) : {}
      const ok = typeof raw.mac === "string" && raw.mac === (await this.#mac(files))
      return { files, tampered: !ok }
    } catch {
      return { files: {}, tampered: true }
    }
  }

  async #write(root: string, files: Record<string, string>): Promise<void> {
    fs.mkdirSync(this.#d.dir, { recursive: true })
    const body: LockFile = { version: 1, files, mac: await this.#mac(files) }
    await writeFileAtomic(this.#file(root), JSON.stringify(body, null, 2) + "\n")
  }

  static rootOf(cwd: string): string {
    return path.resolve(findProjectRoot(cwd))
  }

  /** Locks a file of the project (desktop only). Refused while the lock file is tampered: accept or unlock first. */
  async lock(cwd: string, file: string): Promise<string> {
    const root = TestLocks.rootOf(cwd)
    const abs = path.resolve(cwd, file)
    const r = rel(root, abs)
    if (r.startsWith("..") || path.isAbsolute(r)) throw new TestLockError("Only a file inside the project can be locked.")
    const h = hashOf(abs)
    if (!h) throw new TestLockError("That file is not there.")
    const cur = await this.#read(root)
    if (cur.tampered) throw new TestLockError("The lock file was changed outside Codehouse. Accept the locks again first.")
    await this.#write(root, { ...cur.files, [r]: h })
    return r
  }

  async unlock(cwd: string, relPath: string): Promise<void> {
    const root = TestLocks.rootOf(cwd)
    const cur = await this.#read(root)
    const files = { ...cur.files }
    delete files[relPath]
    await this.#write(root, files)
  }

  async state(cwd: string): Promise<LockState> {
    const root = TestLocks.rootOf(cwd)
    const cur = await this.#read(root)
    return {
      tampered: cur.tampered,
      files: Object.entries(cur.files).map(([p, h]) => {
        const now = hashOf(path.join(root, p))
        return { path: p, missing: now === undefined, changed: now !== undefined && now !== h }
      }),
    }
  }

  /** Locked tests changed outside Codehouse since they were pinned, or the lock file itself. */
  async changedOutside(cwd: string): Promise<string[]> {
    const s = await this.state(cwd)
    if (s.tampered) return ["the lock file"]
    return s.files.filter((f) => f.changed || f.missing).map((f) => f.path)
  }

  /** Takes the files as they are now as the locked versions (the owner accepted them, or an approved change). */
  async repin(cwd: string, only?: string[]): Promise<void> {
    const root = TestLocks.rootOf(cwd)
    const cur = await this.#read(root)
    const files: Record<string, string> = {}
    for (const [p, h] of Object.entries(cur.files)) {
      if (only && !only.includes(p)) {
        files[p] = h
        continue
      }
      const now = hashOf(path.join(root, p))
      // A locked test deleted with the owner's approval is no longer locked.
      if (now) files[p] = now
    }
    await this.#write(root, files)
  }

  /**
   * The owner accepts the locked tests, and the lock file, as they now are, after a change made outside Codehouse.
   * A tampered lock file is sealed again with what it now says, since the owner has looked at it.
   */
  async accept(cwd: string): Promise<void> {
    await this.repin(cwd)
  }

  /**
   * The locked tests a call would change: a file tool's target, or a test a shell command names other than to read
   * or run it. With the lock file tampered, every test file counts. Unsure means it counts.
   */
  async touched(cwd: string, tool: string, input: Record<string, unknown>): Promise<string[]> {
    const root = TestLocks.rootOf(cwd)
    const cur = await this.#read(root)
    const locked = new Set(Object.keys(cur.files).map((p) => p.toLowerCase()))
    if (!locked.size && !cur.tampered) return []
    const isLocked = (word: string) => {
      const r = rel(root, path.resolve(cwd, word)).toLowerCase()
      return locked.has(r) || (cur.tampered && isTestFile(r))
    }
    if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
      const f = typeof input.file_path === "string" ? input.file_path : input.notebook_path
      return typeof f === "string" && isLocked(f) ? [rel(root, path.resolve(cwd, f))] : []
    }
    if (tool !== "Bash" && tool !== "PowerShell") return []
    const command = typeof input.command === "string" ? input.command : ""
    const out: string[] = []
    for (const words of commandsOf(command)) {
      // A redirect into a locked test changes it, whatever the command: "> f", ">f", "2>> f".
      const redirects: string[] = []
      words.forEach((w, i) => {
        const m = /^\d?>>?(.*)$/.exec(w)
        if (m) redirects.push(m[1] || (words[i + 1] ?? ""))
      })
      for (const r of redirects) if (r && isLocked(r)) out.push(rel(root, path.resolve(cwd, r)))
      const named = words
        .slice(1)
        .filter((w) => !w.startsWith("-") && !redirects.includes(w) && isLocked(w))
      if (!named.length) continue
      const name = (words[0] ?? "").toLowerCase().replace(/\.exe$/, "")
      const readOnly = READ_ONLY.has(name) || READ_ONLY_PAIRS.test(words.join(" "))
      if (!readOnly) out.push(...named.map((w) => rel(root, path.resolve(cwd, w))))
    }
    return [...new Set(out)]
  }
}

export const lockedReason = (files: string[]) =>
  `It would change the locked test ${files[0]}${files.length > 1 ? ` and ${files.length - 1} more` : ""}. Locked tests change only with you, even in Extreme approval.`

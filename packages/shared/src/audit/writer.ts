import fs from "node:fs"
import path from "node:path"
import { canonicalize } from "../canonical.js"
import {
  AuditRecord,
  GENESIS_HASH,
  MONTH_FILE,
  hashRecord,
  monthFileName,
  type AuditEntry,
  type AuditHead,
} from "./record.js"

export class AuditLockError extends Error {}
export class AuditIntegrityError extends Error {}

export interface AuditWriterOptions {
  dir: string
  /**
   * Required. Applied to every field of an entry before it is stored (invariant 12). There is
   * deliberately no default, so a caller cannot forget it.
   */
  redact: <T>(value: T) => T
  now?: () => Date
  lockTimeoutMs?: number
  /** A lock file older than this is taken to belong to a crashed process. */
  staleLockMs?: number
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function headPath(dir: string): string {
  return path.join(dir, "head.json")
}

export function listAuditFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => MONTH_FILE.test(f))
    .sort()
}

/** Reads the last complete line of a file, growing the window until a whole line is in it. */
function lastLine(file: string): { line: string | undefined; torn: boolean; tornFrom: number } {
  const fd = fs.openSync(file, "r")
  try {
    const size = fs.fstatSync(fd).size
    if (size === 0) return { line: undefined, torn: false, tornFrom: 0 }
    let window = 64 * 1024
    for (;;) {
      const start = Math.max(0, size - window)
      const buf = Buffer.alloc(size - start)
      fs.readSync(fd, buf, 0, buf.length, start)
      const endsWithNewline = buf[buf.length - 1] === 0x0a
      const lastNl = buf.lastIndexOf(0x0a)
      if (lastNl < 0) {
        // No complete line in the window.
        if (start === 0) return { line: undefined, torn: true, tornFrom: 0 }
        window *= 4
        continue
      }
      // Bytes up to and including lastNl are complete lines. Anything after is a torn final line
      // (a crash mid-write) that was never acknowledged to a caller.
      const prevNl = lastNl === 0 ? -1 : buf.lastIndexOf(0x0a, lastNl - 1)
      if (prevNl < 0 && start > 0) {
        window *= 4
        continue
      }
      return {
        line: buf.subarray(prevNl + 1, lastNl).toString("utf8"),
        torn: !endsWithNewline,
        tornFrom: start + lastNl + 1,
      }
    }
  } finally {
    fs.closeSync(fd)
  }
}

/** Errors Windows raises transiently while a scanner or another process has a file open. */
const TRANSIENT = new Set(["EPERM", "EACCES", "EBUSY"])

async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text)
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? ""
      if (!TRANSIENT.has(code) || attempt >= 40) {
        // head.json only speeds up and cross-checks recovery, and the log itself is the source
        // of truth, so fall back to writing it in place rather than failing an append that landed.
        fs.rmSync(tmp, { force: true })
        fs.writeFileSync(file, text)
        return
      }
      await sleep(5 + attempt * 2)
    }
  }
}

/**
 * Appends to the hash-chained audit log. One JSONL file per month. Several processes may append:
 * writes are serialised with an exclusive lock file.
 */
export class AuditWriter {
  readonly #dir: string
  readonly #redact: AuditWriterOptions["redact"]
  readonly #now: () => Date
  readonly #lockTimeoutMs: number
  readonly #staleLockMs: number
  #queue: Promise<unknown> = Promise.resolve()

  constructor(opts: AuditWriterOptions) {
    if (typeof opts.redact !== "function") throw new TypeError("AuditWriter needs a redact function")
    this.#dir = opts.dir
    this.#redact = opts.redact
    this.#now = opts.now ?? (() => new Date())
    this.#lockTimeoutMs = opts.lockTimeoutMs ?? 5000
    this.#staleLockMs = opts.staleLockMs ?? 10000
  }

  get dir(): string {
    return this.#dir
  }

  /** Appends one record and returns it as written. Rejects if it could not be written. */
  append(entry: AuditEntry): Promise<AuditRecord> {
    const run = this.#queue.then(() => this.#appendLocked(entry))
    this.#queue = run.catch(() => undefined)
    return run
  }

  /** The head recorded by the last append (or recovered from the files). */
  head(): AuditHead | undefined {
    // Read-only: another process may be part-way through a write, so never repair here.
    return this.#readHead(false)?.head
  }

  async #acquire(): Promise<() => void> {
    fs.mkdirSync(this.#dir, { recursive: true })
    const lock = path.join(this.#dir, "audit.lock")
    const deadline = Date.now() + this.#lockTimeoutMs
    for (;;) {
      try {
        const fd = fs.openSync(lock, "wx")
        fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`)
        return () => {
          try {
            fs.closeSync(fd)
          } catch {
            // already closed
          }
          fs.rmSync(lock, { force: true })
        }
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? ""
        // EEXIST: someone holds it. EPERM and friends: Windows keeps a just-deleted file in a
        // delete-pending state for a moment, and creating it again fails until it goes.
        if (code !== "EEXIST" && !TRANSIENT.has(code)) throw e
        if (code !== "EEXIST") {
          if (Date.now() > deadline) throw new AuditLockError(`Could not create the audit lock (${code})`)
          await sleep(5 + Math.floor(Math.random() * 20))
          continue
        }
        try {
          const age = Date.now() - fs.statSync(lock).mtimeMs
          if (age > this.#staleLockMs) {
            fs.rmSync(lock, { force: true })
            continue
          }
        } catch {
          continue // released between the two calls
        }
        if (Date.now() > deadline) throw new AuditLockError("Timed out waiting for the audit lock")
        await sleep(5 + Math.floor(Math.random() * 20))
      }
    }
  }

  /** The newest record on disk, healing a torn final line, plus the head file as a cross-check. */
  #readHead(heal = true): { head: AuditHead; fromFile: boolean } | undefined {
    const files = listAuditFiles(this.#dir)
    let last: AuditRecord | undefined
    let lastFile = ""
    for (let i = files.length - 1; i >= 0 && !last; i--) {
      const file = path.join(this.#dir, files[i] as string)
      const { line, torn, tornFrom } = lastLine(file)
      // Only the lock holder may repair: a torn line seen by a reader may be a write in progress.
      if (torn && heal) fs.truncateSync(file, tornFrom) // a record that was never acknowledged
      if (line === undefined || line === "") continue
      let parsed: AuditRecord
      try {
        parsed = AuditRecord.parse(JSON.parse(line))
      } catch {
        throw new AuditIntegrityError(`The last line of ${files[i]} is not a valid audit record`)
      }
      last = parsed
      lastFile = files[i] as string
    }
    let head: AuditHead | undefined
    try {
      head = JSON.parse(fs.readFileSync(headPath(this.#dir), "utf8")) as AuditHead
    } catch {
      head = undefined
    }
    if (head && (!last || head.seq > last.seq)) {
      throw new AuditIntegrityError(
        `head.json says seq ${head.seq} but the log ends at ${last?.seq ?? 0}: the log has been truncated`,
      )
    }
    if (!last) return undefined
    return { head: { seq: last.seq, hash: last.hash, file: lastFile }, fromFile: true }
  }

  async #appendLocked(entry: AuditEntry): Promise<AuditRecord> {
    const release = await this.#acquire()
    try {
      const prev = this.#readHead()?.head ?? { seq: 0, hash: GENESIS_HASH, file: "" }
      const ts = this.#now().toISOString()
      const clean = this.#redact({
        session: entry.session,
        event: entry.event,
        tool: entry.tool,
        toolUseId: entry.toolUseId,
        cwd: entry.cwd,
        project: entry.project,
        verdict: entry.verdict,
        judgeRationale: entry.judgeRationale,
      })
      const redactedInput = this.#redact(entry.input === undefined ? null : entry.input)
      const body: Omit<AuditRecord, "hash"> = {
        v: 1,
        seq: prev.seq + 1,
        ts,
        session: clean.session,
        event: clean.event,
        channel: entry.channel,
        tool: clean.tool,
        ...(clean.toolUseId !== undefined ? { toolUseId: clean.toolUseId } : {}),
        ...(clean.cwd !== undefined ? { cwd: clean.cwd } : {}),
        ...(clean.project !== undefined ? { project: clean.project } : {}),
        inputJson: canonicalize(redactedInput),
        verdict: clean.verdict,
        latencyMs: Math.max(0, Math.round(entry.latencyMs)),
        ...(clean.judgeRationale !== undefined ? { judgeRationale: clean.judgeRationale } : {}),
        prevHash: prev.hash,
      }
      const record: AuditRecord = AuditRecord.parse({ ...body, hash: hashRecord(body) })
      const file = monthFileName(ts)
      const fd = fs.openSync(path.join(this.#dir, file), "a")
      try {
        fs.writeSync(fd, JSON.stringify(record) + "\n")
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
      await writeAtomic(headPath(this.#dir), JSON.stringify({ seq: record.seq, hash: record.hash, file }) + "\n")
      return record
    } finally {
      release()
    }
  }
}

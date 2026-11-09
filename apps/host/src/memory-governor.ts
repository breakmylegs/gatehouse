/**
 * C-004, the memory governor (Frontier build, before Wave 1). Above a commit charge you set in Settings (85% unless
 * you choose), Codehouse starts nothing heavy of its own: no new session or chat, no page look. Each refusal is in the
 * audit log before it is given, with the reading, and the screen offers idle sessions to suspend.
 *
 * The commit charge is what Windows has promised to programs against what RAM and the page file can hold; past its
 * limit programs fail (owner, 1 Nov: a crash when Windows ran out of memory stopped a build session). It is read by
 * Codehouse-Helper.exe --memory (GlobalMemoryStatusEx), never through PowerShell. When it cannot be read, nothing is
 * refused: the governor protects the computer, and a reading it does not have says nothing about it.
 */
import { execFile } from "node:child_process"
import type { HostAudit } from "./hostaudit.js"

export interface MemoryReading {
  commitUsed: number
  commitLimit: number
  physTotal: number
  physAvail: number
}

/** The commit charge, as a share of its limit, from which Codehouse starts nothing heavy. */
export const DEFAULT_MEMORY_PERCENT = 85
/** How long one reading is used for. */
const READING_MS = 5_000

/** The point from Settings: off, a percentage from 50 to 99, or the default. */
export function memoryPoint(s: { percent?: number; off?: boolean } | undefined): number | undefined {
  if (s?.off) return undefined
  return s && Number.isInteger(s.percent) && s.percent! >= 50 && s.percent! <= 99
    ? s.percent
    : DEFAULT_MEMORY_PERCENT
}

/** The commit charge as a whole percentage of its limit, or undefined for a reading that makes no sense. */
export function commitPercent(r: MemoryReading | undefined): number | undefined {
  if (!r || !(r.commitLimit > 0) || !(r.commitUsed >= 0)) return undefined
  return Math.round((100 * r.commitUsed) / r.commitLimit)
}

/** One line of the helper's JSON, or undefined when it is not one. */
export function parseReading(text: string): MemoryReading | undefined {
  try {
    const j = JSON.parse(text.trim()) as Record<string, unknown>
    const n = (k: string) => (typeof j[k] === "number" && Number.isFinite(j[k]) ? (j[k] as number) : NaN)
    const r = {
      commitUsed: n("commitUsed"),
      commitLimit: n("commitLimit"),
      physTotal: n("physTotal"),
      physAvail: n("physAvail"),
    }
    return Object.values(r).every((v) => v >= 0) && r.commitLimit > 0 ? r : undefined
  } catch {
    return undefined
  }
}

/** Reads memory through Codehouse-Helper.exe, or nothing where the helper cannot be had or does not answer. */
export function helperReader(helper: () => string | undefined): () => Promise<MemoryReading | undefined> {
  return () =>
    new Promise((resolve) => {
      const exe = helper()
      if (!exe) return resolve(undefined)
      execFile(exe, ["--memory"], { windowsHide: true, timeout: 5_000 }, (e, out) =>
        resolve(e ? undefined : parseReading(String(out))),
      )
    })
}

export type HeavyJob = "session" | "chat" | "page look" | "session started again"

export class MemoryRefusedError extends Error {
  constructor(
    readonly percent: number,
    readonly point: number,
    readonly what: HeavyJob,
  ) {
    super(
      `This computer's memory is ${percent}% committed, over the ${point}% set in Settings, so Codehouse did not start a new ${what}. Suspend a session you are not using, close other programs, or change the point in Settings, Sessions.`,
    )
  }
}

export interface MemoryGovernorDeps {
  read: () => Promise<MemoryReading | undefined>
  /** The point from Settings, read at each look; undefined when the governor is off. */
  point: () => number | undefined
  audit: Pick<HostAudit, "record">
  log: (line: string) => void
  now?: () => number
}

export class MemoryGovernor {
  readonly #d: MemoryGovernorDeps
  #last: { at: number; value: MemoryReading | undefined } | undefined
  #pending: Promise<MemoryReading | undefined> | undefined

  constructor(d: MemoryGovernorDeps) {
    this.#d = d
  }

  /** The reading, at most five seconds old. */
  async reading(): Promise<MemoryReading | undefined> {
    const now = (this.#d.now ?? Date.now)()
    if (this.#last && now - this.#last.at < READING_MS) return this.#last.value
    this.#pending ??= this.#d
      .read()
      .catch(() => undefined)
      .then((value) => {
        this.#last = { at: (this.#d.now ?? Date.now)(), value }
        this.#pending = undefined
        return value
      })
    return await this.#pending
  }

  /** Where it stands: the reading, its share, the point, and whether something heavy would be refused now. */
  async status(): Promise<{
    reading?: MemoryReading
    percent?: number
    point?: number
    over: boolean
  }> {
    const reading = await this.reading()
    const percent = commitPercent(reading)
    const point = this.#d.point()
    return {
      ...(reading ? { reading } : {}),
      ...(percent !== undefined ? { percent } : {}),
      ...(point !== undefined ? { point } : {}),
      over: percent !== undefined && point !== undefined && percent >= point,
    }
  }

  /**
   * Lets something heavy start, or refuses it with the reason. A refusal is recorded first; if the record cannot be
   * written it is still refused, since refusing is the safe side.
   */
  async admit(what: HeavyJob, detail: Record<string, unknown> = {}): Promise<void> {
    const s = await this.status()
    if (!s.over) return
    const percent = s.percent!
    const point = s.point!
    const err = new MemoryRefusedError(percent, point, what)
    const written = await this.#d.audit
      .record({
        session: typeof detail.sessionId === "string" ? detail.sessionId : "host",
        event: "memory_refused",
        channel: "host",
        tool: "session",
        input: { what, percent, point, ...detail },
        verdict: {
          outcome: "deny",
          ruleId: "memory-governor",
          reason: err.message,
          risk: 0,
          decidedBy: "rules",
          policyHash: "",
        },
        latencyMs: 0,
      })
      .catch(() => false)
    if (!written) this.#d.log("memory governor: a refusal could not be recorded (refused all the same)")
    throw err
  }
}

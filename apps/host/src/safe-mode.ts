/**
 * E-096 (expansion, Wave E1): safe mode. Codehouse starts with the least that could be at fault: no sessions brought
 * back, no plugins, no routines, no warm chat, no MCP servers started with it, and the push channels paused, with a
 * banner saying why. It is entered from Doctor (or with GATEHOUSE_SAFE_MODE=1 at start, for the tray), after three
 * crash restarts in ten minutes, or when a safety canary fails (E-100). Leaving it is a desktop action, and both are
 * in the audit log.
 *
 * A crash restart is a start whose previous start never stopped cleanly: each start is written down when it begins and
 * marked clean when the Host stops in order, so nothing outside the Host is needed to count them.
 */
import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance } from "fastify"

export type SafeModeReason = "doctor" | "start-flag" | "crash-restarts" | "canary"

export interface SafeModeState {
  on: boolean
  reason?: SafeModeReason
  since?: string
}

export const CRASHES_FOR_SAFE_MODE = 3
export const CRASH_WINDOW_MS = 10 * 60_000

/** What starts with Codehouse, and so what safe mode leaves out. */
export interface StartupPlan {
  restoreSessions: boolean
  routines: boolean
  autostartMcp: boolean
  pushChannels: boolean
  warmChat: boolean
  plugins: boolean
}

export function safeModePlan(on: boolean): StartupPlan {
  return { restoreSessions: !on, routines: !on, autostartMcp: !on, pushChannels: !on, warmChat: !on, plugins: !on }
}

export const REASON_TEXT: Record<SafeModeReason, string> = {
  doctor: "you chose it in Doctor",
  "start-flag": "Codehouse was started in safe mode",
  "crash-restarts": `Codehouse stopped unexpectedly ${CRASHES_FOR_SAFE_MODE} times in ten minutes`,
  canary: "a safety check failed",
}

/**
 * GET /api/safe-mode, and POST /api/safe-mode { on }: Doctor's "Start in safe mode" (from the next start) and the
 * banner's "Leave safe mode". The Host's API is the desktop's alone (Neighbourhood Watch and the phone cannot call it),
 * so leaving is always a desktop action.
 */
export function registerSafeModeRoutes(app: FastifyInstance, safe: SafeMode, onChange?: () => void): void {
  app.get("/api/safe-mode", async () => safe.state())
  app.post("/api/safe-mode", async (req) => {
    const on = (req.body as { on?: unknown } | undefined)?.on === true
    const s = on ? await safe.enter("doctor") : await safe.leave()
    onChange?.()
    return { ...s, restartNeeded: true }
  })
}

interface Starts {
  starts: Array<{ at: number; clean: boolean }>
}

const write = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, file)
}

const read = <T>(file: string, fallback: T): T => {
  try {
    return { ...fallback, ...(JSON.parse(fs.readFileSync(file, "utf8")) as T) }
  } catch {
    return fallback
  }
}

export class SafeMode {
  readonly #state: string
  readonly #starts: string

  constructor(
    dataDir: string,
    private readonly o: {
      /** Records safe_mode_entered and safe_mode_left. */
      audit: (event: "safe_mode_entered" | "safe_mode_left" | "host_crash_restart", input: Record<string, unknown>) => Promise<unknown>
      now?: () => number
    },
  ) {
    this.#state = path.join(dataDir, "safe-mode.json")
    this.#starts = path.join(dataDir, "starts.json")
  }

  state(): SafeModeState {
    const s = read<SafeModeState>(this.#state, { on: false })
    return { on: s.on === true, ...(s.reason ? { reason: s.reason } : {}), ...(s.since ? { since: s.since } : {}) }
  }

  get on(): boolean {
    return this.state().on
  }

  /**
   * At the start of the Host: writes this start down, and counts the earlier starts in the last ten minutes that never
   * stopped cleanly. Three of them, and this start is in safe mode.
   */
  async noteStart(): Promise<SafeModeState> {
    const now = this.o.now?.() ?? Date.now()
    const all = read<Starts>(this.#starts, { starts: [] }).starts
    // E-099: the start before this one never stopped cleanly, so this one follows a crash; the health score counts them.
    const previous = all.at(-1)
    if (previous && !previous.clean) await this.o.audit("host_crash_restart", { previousStart: new Date(previous.at).toISOString() })
    const recent = all.filter((s) => typeof s.at === "number" && now - s.at < CRASH_WINDOW_MS)
    const crashes = recent.filter((s) => !s.clean).length
    write(this.#starts, { starts: [...recent, { at: now, clean: false }].slice(-20) })
    if (crashes >= CRASHES_FOR_SAFE_MODE && !this.on) await this.enter("crash-restarts", { crashes })
    return this.state()
  }

  /** When the Host stops in order: this start was not a crash. */
  noteCleanStop(): void {
    const s = read<Starts>(this.#starts, { starts: [] })
    const last = s.starts.at(-1)
    if (!last) return
    last.clean = true
    write(this.#starts, s)
  }

  async enter(reason: SafeModeReason, detail: Record<string, unknown> = {}): Promise<SafeModeState> {
    if (this.on) return this.state()
    const since = new Date(this.o.now?.() ?? Date.now()).toISOString()
    write(this.#state, { on: true, reason, since })
    await this.o.audit("safe_mode_entered", { reason, ...detail })
    return this.state()
  }

  /** A desktop action only (the API is the desktop's alone); everything starts again at the next start. */
  async leave(): Promise<SafeModeState> {
    const was = this.state()
    if (!was.on) return was
    write(this.#state, { on: false })
    // A fresh count: the crashes that led here are not counted again.
    write(this.#starts, { starts: [] })
    await this.o.audit("safe_mode_left", { reason: was.reason ?? "unknown" })
    return this.state()
  }
}

/**
 * E-089 (expansion, Wave E1): battery-aware scheduling. Every two minutes the Host reads whether the computer runs on
 * battery (Windows: Win32_Battery's status through PowerShell; a Mac: pmset). On battery, the heavy jobs Codehouse
 * starts by itself (routines, the timeline's summaries) wait and run when mains power is back, and new sessions start
 * at a lower resource level. Extreme approval keeps running unless you turned on "Pause Extreme on battery". Each change
 * of power state is in the audit log.
 *
 * Mac fork (owner, 25 Nov): a Mac's reading also gives the charge. On battery at LOW_BATTERY_PERCENT or less, the
 * battery is low: Extreme approval pauses whatever the setting says, and the Mac is no longer kept awake (main.ts), so
 * an unattended run does not drain it. Both come back on mains power. Windows' reading has no charge, so it is never low.
 */
import { execFile } from "node:child_process"

export type PowerSource = "battery" | "mains" | "unknown"
/** A reading with the charge, where the computer gives it (a Mac). */
export type PowerReading = PowerSource | { source: PowerSource; percent?: number }

/** On battery at this charge or less, the battery is low (macOS warns at 10%, so this is before it). */
export const LOW_BATTERY_PERCENT = 20

/** Win32_Battery's BatteryStatus: 1 is discharging (on battery); any other, or no battery, is mains. */
export function parseWindows(stdout: string): PowerSource {
  const codes = stdout.split(/\s+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n))
  if (!codes.length) return "mains"
  return codes.some((c) => c === 1) ? "battery" : "mains"
}

/** `pmset -g batt` says "Now drawing from 'Battery Power'" or "'AC Power'". */
export function parseMac(stdout: string): PowerSource {
  if (/'Battery Power'/.test(stdout)) return "battery"
  if (/'AC Power'/.test(stdout)) return "mains"
  return "unknown"
}

/** The charge in `pmset -g batt`'s battery line ("-InternalBattery-0 (id=...)	85%; discharging; ..."). */
export function parseMacPercent(stdout: string): number | undefined {
  const m = /\t(\d{1,3})%;/.exec(stdout) ?? /\s(\d{1,3})%;/.exec(stdout)
  const n = m ? Number(m[1]) : NaN
  return n >= 0 && n <= 100 ? n : undefined
}

function parseMacReading(stdout: string): PowerReading {
  const percent = parseMacPercent(stdout)
  return { source: parseMac(stdout), ...(percent !== undefined ? { percent } : {}) }
}

export function readPower(platform: NodeJS.Platform = process.platform): Promise<PowerReading> {
  return new Promise((resolve) => {
    const done = (parse: (s: string) => PowerReading) => (e: Error | null, out: string | Buffer) => resolve(e ? "unknown" : parse(String(out)))
    if (platform === "win32")
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance -ClassName Win32_Battery).BatteryStatus"],
        { windowsHide: true, timeout: 20_000 },
        done(parseWindows),
      )
    else if (platform === "darwin") execFile("pmset", ["-g", "batt"], { timeout: 10_000 }, done(parseMacReading))
    else resolve("unknown")
  })
}

export interface PowerDeps {
  read?: () => Promise<PowerReading>
  /** A change of source; or, with `low`, the battery going low on a Mac, with its charge. */
  audit: (input: { source: PowerSource; was: PowerSource; low?: true; percent?: number }) => Promise<unknown>
  /** The setting "Pause Extreme on battery" (off unless chosen). */
  pauseExtremeOnBattery: () => boolean
  /** Pauses each Extreme session, for the battery; called when power goes to battery with the setting on. */
  pauseExtreme?: () => void
  /** Starts again the sessions the battery paused; called when power goes back to mains. */
  resumeExtreme?: () => void
  log?: (line: string) => void
}

export class Power {
  #source: PowerSource = "unknown"
  #percent: number | undefined
  #waiting: Array<{ name: string; run: () => void }> = []
  #timer: NodeJS.Timeout | undefined

  constructor(private readonly d: PowerDeps) {}

  get source(): PowerSource {
    return this.#source
  }

  get onBattery(): boolean {
    return this.#source === "battery"
  }

  /** Mac fork: on battery at LOW_BATTERY_PERCENT or less. Never without a charge in the reading (Windows). */
  get low(): boolean {
    return this.onBattery && this.#percent !== undefined && this.#percent <= LOW_BATTERY_PERCENT
  }

  /** Jobs waiting for mains power, by name. */
  waiting(): string[] {
    return this.#waiting.map((w) => w.name)
  }

  /** Runs a heavy job now, or keeps it until mains power is back when on battery. */
  heavy(name: string, run: () => void): "ran" | "deferred" {
    if (!this.onBattery) {
      run()
      return "ran"
    }
    // One of each kind waits: a routine due again while on battery runs once when power is back.
    if (!this.#waiting.some((w) => w.name === name)) this.#waiting.push({ name, run })
    return "deferred"
  }

  /** The resource level a new session starts with when none is given. */
  defaultResources<T extends string>(usual: T, low: T): T {
    return this.onBattery ? low : usual
  }

  /** Takes a reading, and acts on a change. */
  async check(): Promise<PowerSource> {
    const reading = await (this.d.read ?? readPower)()
    const next = typeof reading === "string" ? reading : reading.source
    if (next === "unknown") return this.#source
    const wasLow = this.low
    if (typeof reading !== "string") this.#percent = reading.percent
    if (next === this.#source) {
      if (this.low && !wasLow) await this.#wentLow()
      return this.#source
    }
    const was = this.#source
    this.#source = next
    await this.d.audit({ source: next, was })
    this.d.log?.(`power: now on ${next}`)
    if (next === "battery" && this.d.pauseExtremeOnBattery()) this.d.pauseExtreme?.()
    else if (this.low) await this.#wentLow()
    if (next === "mains") {
      if (was === "battery") this.d.resumeExtreme?.()
      const due = this.#waiting
      this.#waiting = []
      for (const w of due) w.run()
    }
    return next
  }

  /** The battery went low: audited, and Extreme approval pauses until mains power (resumeExtreme, as above). */
  async #wentLow(): Promise<void> {
    await this.d.audit({ source: this.#source, was: this.#source, low: true, ...(this.#percent !== undefined ? { percent: this.#percent } : {}) })
    this.d.log?.(`power: the battery is low (${this.#percent}%)`)
    this.d.pauseExtreme?.()
  }

  start(everyMs = 120_000): void {
    void this.check()
    this.#timer = setInterval(() => void this.check(), everyMs)
    this.#timer.unref?.()
  }

  stop(): void {
    clearInterval(this.#timer)
  }
}

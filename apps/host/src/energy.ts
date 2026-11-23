/**
 * E-090, energy and carbon estimate (Expansion E6). The energy a project's sessions used on this computer, estimated
 * from the CPU time of their job objects (the share of the machine the job-object helper reports every few seconds)
 * and a device power figure you can set (the computer's draw at full load, in watts). The models' energy is shown
 * only from a figure you enter (watt-hours per thousand tokens); otherwise it is "not known", never guessed. Carbon
 * comes from a grid intensity you enter (grams of CO2e per kWh), or is "not known". Everything is labelled as an
 * estimate. CPU time is kept per project and day in Codehouse's data folder.
 */
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"

export const NOT_KNOWN = "not known"
/** A laptop at full load, unless you say otherwise. */
export const DEFAULT_DEVICE_WATTS = 45

export interface EnergyConfig {
  deviceWatts?: number
  gridGramsPerKwh?: number
  modelWhPer1kTokens?: number
}

export interface EnergyEstimate {
  label: "estimate"
  cpuSeconds: number
  localWh: number
  modelWh: number | typeof NOT_KNOWN
  carbonGrams: number | typeof NOT_KNOWN
  basis: string
}

/** CPU seconds from one usage sample: the job's share of the whole machine, over the time it covers. */
export const cpuSecondsOf = (cpuPercent: number, intervalSeconds: number, cores: number) => Math.max(0, cpuPercent) / 100 * cores * intervalSeconds

export function estimate(o: { cpuSeconds: number; cores: number; tokens?: number; config?: EnergyConfig }): EnergyEstimate {
  const watts = o.config?.deviceWatts && o.config.deviceWatts > 0 ? o.config.deviceWatts : DEFAULT_DEVICE_WATTS
  const cores = Math.max(1, o.cores)
  // The machine's draw at full load, for the share of all its cores the sessions kept busy.
  const localWh = (o.cpuSeconds / cores) * watts / 3600
  const per1k = o.config?.modelWhPer1kTokens
  const modelWh = typeof per1k === "number" && per1k >= 0 && typeof o.tokens === "number" ? (o.tokens / 1000) * per1k : NOT_KNOWN
  const grid = o.config?.gridGramsPerKwh
  const knownWh = localWh + (typeof modelWh === "number" ? modelWh : 0)
  const carbonGrams = typeof grid === "number" && grid >= 0 ? (knownWh / 1000) * grid : NOT_KNOWN
  const basis = [
    `${round(o.cpuSeconds)} CPU seconds over ${cores} core(s), at ${watts} W for the computer at full load${o.config?.deviceWatts ? " (your figure)" : " (a typical laptop; set yours in Settings)"}`,
    typeof modelWh === "number" ? `${o.tokens} tokens at ${per1k} Wh per thousand (your figure)` : "the models' energy is not known: enter a figure to include it",
    typeof carbonGrams === "number" ? `grid at ${grid} g CO2e per kWh (your figure)${typeof modelWh === "number" ? "" : ", for this computer's energy only"}` : "carbon is not known: enter your grid's intensity to include it",
  ].join("; ")
  return { label: "estimate", cpuSeconds: round(o.cpuSeconds), localWh: round(localWh, 3), modelWh: typeof modelWh === "number" ? round(modelWh, 3) : modelWh, carbonGrams: typeof carbonGrams === "number" ? round(carbonGrams, 2) : carbonGrams, basis }
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d

type EnergyFile = { days: Record<string, Record<string, number>> } & Record<string, unknown>

/** CPU seconds by day and project. */
export class EnergyLog {
  readonly #file: string | undefined
  readonly #now: () => Date
  #data: EnergyFile = { days: {} }
  #dirty = false
  #timer: NodeJS.Timeout | undefined

  constructor(file?: string, now: () => Date = () => new Date()) {
    this.#file = file
    this.#now = now
    if (file && fs.existsSync(file)) {
      try {
        const v = JSON.parse(fs.readFileSync(file, "utf8")) as EnergyFile
        if (v && typeof v.days === "object" && v.days) this.#data = v
      } catch {
        // A damaged log starts again.
      }
    }
  }

  add(project: string, cpuSeconds: number): void {
    if (!(cpuSeconds > 0)) return
    const d = this.#now()
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const byProject = (this.#data.days[day] ??= {})
    byProject[project] = (byProject[project] ?? 0) + cpuSeconds
    this.#dirty = true
    // Samples come every few seconds: written at most once a minute.
    if (this.#file && !this.#timer) {
      this.#timer = setTimeout(() => {
        this.#timer = undefined
        void this.flush()
      }, 60_000)
      this.#timer.unref?.()
    }
  }

  /** CPU seconds for a project (or all), from..to (YYYY-MM-DD, both included). */
  cpuSeconds(project?: string, from?: string, to?: string): number {
    let n = 0
    for (const [day, byProject] of Object.entries(this.#data.days)) {
      if ((from && day < from) || (to && day > to)) continue
      for (const [p, s] of Object.entries(byProject)) if (!project || p === project) n += s
    }
    return n
  }

  async flush(): Promise<void> {
    if (!this.#file || !this.#dirty) return
    this.#dirty = false
    fs.mkdirSync(path.dirname(this.#file), { recursive: true })
    await writeFileAtomic(this.#file, JSON.stringify(this.#data, null, 2) + "\n")
  }
}

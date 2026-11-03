/**
 * What a session's processes use now (owner, 1 Nov: a processor and memory bar per session), as its limits helper says
 * every few seconds: its share of this computer's whole processor, the memory its processes hold, and the cap for its
 * level (0 for none) beside this computer's memory.
 */
export interface Load {
  cpu: number
  memoryMb: number
  processes: number
  capMb: number
  totalMb: number
  at: number
}

const num = (v: unknown, max: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : undefined

/** A load event's data, read tolerantly: anything missing or out of range means no reading. */
export function loadOf(data: Record<string, unknown>, now = Date.now()): Load | undefined {
  const cpu = num(data.cpu, 100)
  const memoryMb = num(data.memoryMb, 1 << 30)
  const processes = num(data.processes, 1 << 20) ?? 0
  const capMb = num(data.capMb, 1 << 30) ?? 0
  const totalMb = num(data.totalMb, 1 << 30) ?? 0
  if (cpu === undefined || memoryMb === undefined) return undefined
  return { cpu, memoryMb, processes, capMb, totalMb, at: now }
}

/** "812 MB" or "3.2 GB". */
export const megabytes = (mb: number): string =>
  mb >= 1024 ? `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB` : `${Math.round(mb)} MB`

/** How full each bar is (0 to 100), and what it says in words. Memory is against the cap, else this computer's. */
export function loadBars(l: Load): {
  cpu: number
  memory: number
  words: string
} {
  const of = l.capMb || l.totalMb
  const memory = of ? Math.min(100, (100 * l.memoryMb) / of) : 0
  const cpu = Math.round(l.cpu)
  return {
    cpu,
    memory,
    words: `Processor ${cpu}% of this computer. Memory ${megabytes(l.memoryMb)}${
      l.capMb
        ? ` of its ${megabytes(l.capMb)} limit`
        : of
          ? ` of this computer's ${megabytes(of)}`
          : ""
    }, in ${l.processes} process${l.processes === 1 ? "" : "es"}.`,
  }
}

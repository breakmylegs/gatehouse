/**
 * Why Codehouse stopped, when Windows ended it with only an exit code (0xC0000409 is Node aborting on a fatal error: out
 * of memory, or an internal assertion). The launcher keeps the Host's last error lines and writes them to
 * last-stop.txt when it stops unexpectedly; at the next start, seconds later, they are redacted (invariant 12), added to
 * host.log, and the file is deleted. And the Host's memory is noted in host.log every so often, so a slow growth
 * towards the heap limit shows before a stop.
 */
import fs from "node:fs"
import path from "node:path"
import v8 from "node:v8"

export const LAST_STOP = "last-stop.txt"
const MAX = 12_000

/** Reads the launcher's note of the last stop, if there is one: redacted, logged line by line, then deleted. */
export function reportLastStop(dataDir: string, redact: (text: string) => string, log: (line: string) => void): boolean {
  const file = path.join(dataDir, LAST_STOP)
  let text: string
  try {
    text = fs.readFileSync(file, "utf8").slice(-MAX)
  } catch {
    return false
  }
  try {
    const [how = "", ...lines] = redact(text).split(/\r?\n/)
    const said = lines.map((l) => l.trimEnd()).filter((l) => l.trim())
    log(`the Host's last error output before it stopped with ${how.trim() || "an unknown code"}${said.length ? ":" : ": nothing"}`)
    for (const l of said.slice(-30)) log(`  | ${l}`)
  } finally {
    fs.rmSync(file, { force: true })
  }
  return true
}

const mb = (n: number) => Math.round(n / 1024 / 1024)

/** The Host's memory now, in words for host.log. */
export function memoryLine(): string {
  const h = v8.getHeapStatistics()
  const u = process.memoryUsage()
  return `memory: heap ${mb(h.used_heap_size)} MB used of a ${mb(h.heap_size_limit)} MB limit, ${mb(u.rss)} MB in all, ${mb(u.external + u.arrayBuffers)} MB outside the heap`
}

/** Notes the memory every interval (15 minutes by default); the timer does not keep the Host running. */
export function noteMemory(log: (line: string) => void, everyMs = 15 * 60_000): () => void {
  const t = setInterval(() => log(memoryLine()), everyMs)
  t.unref?.()
  return () => clearInterval(t)
}

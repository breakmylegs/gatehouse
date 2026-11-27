// O60 (owner, 27 Nov): a vitest run of the whole suite, or one with the browser checks in it, takes the computer's
// heavy-run lock (scripts/heavy-lock.mjs) before it starts, so it waits its turn behind a release or the full gate
// instead of both running out of memory. A run of a few named files does not take it, and a run the full gate or a
// release started already has it (GATEHOUSE_HEAVY_LOCK).
import { heavyLock } from "./heavy-lock.mjs"

const BROWSER = /phone-browser\.test|perf-check|screenshots/

/** Whether this vitest run is a heavy one: no files named (the whole suite), or a browser check among them. */
export function isHeavy(argv = process.argv) {
  const rest = argv.slice(2).filter((a) => !["run", "watch", "related"].includes(a))
  const files = rest.filter((a) => !a.startsWith("-") && !/^\d+$/.test(a))
  return files.length === 0 || files.some((f) => BROWSER.test(f))
}

export default async function setup() {
  if (process.env.GATEHOUSE_NO_HEAVY_LOCK === "1" || !isHeavy()) return undefined
  const release = await heavyLock(`vitest ${process.argv.slice(2).join(" ").slice(0, 120) || "(the whole suite)"}`)
  return () => release()
}

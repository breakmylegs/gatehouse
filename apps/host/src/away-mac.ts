import { execFile } from "node:child_process"

// Mac fork (owner, 18 Nov): "only get push notifications on relay if I am not active here, or I am active here but
// haven't responded for 2 minutes". Whether anyone is using this Mac, for the escalation ladder (broker.ts): away, the
// phone and the push channels are told at once; here, they wait as the ladder says. bootstrap.ts chooses it on a Mac.

/** No keyboard, mouse or trackpad for this long, the screen locked or the Mac asleep included, is away. */
export const AWAY_AFTER_MS = 2 * 60_000

/** ioreg's HIDIdleTime is nanoseconds since the last input. */
export function parseIdleMs(out: string): number | undefined {
  const m = /"HIDIdleTime"\s*=\s*(\d+)/.exec(out)
  return m ? Number(m[1]) / 1e6 : undefined
}

type Run = (file: string, args: string[]) => Promise<string>
const run: Run = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { timeout: 5_000 }, (err, out) => (err ? reject(err) : resolve(String(out)))),
  )

/** True when nobody has used the Mac for AWAY_AFTER_MS. Unreadable counts as here, so the ladder still waits. */
export function macAway(query: Run = run): () => Promise<boolean> {
  return () =>
    query("/usr/sbin/ioreg", ["-c", "IOHIDSystem", "-d", "4", "-k", "HIDIdleTime"])
      .then((out) => (parseIdleMs(out) ?? 0) >= AWAY_AFTER_MS)
      .catch(() => false)
}

import type { HostAudit } from "../hostaudit.js"
import type { PullRequestDetail } from "./github.js"

/**
 * T-080 (t3code review, O31): watch a pull request for a session. While the GitHub connection is on, the Host reads the
 * pull request at most every two minutes, and when a check newly fails or the branch newly conflicts it wakes the
 * session with a short message naming them. Only check names and states are said, never anyone's comments. A wake is a
 * new turn like any message (Extreme approval's turn and spending limits apply), at most one in 15 minutes and 12 a
 * day per watch (the routine-trigger caps, T58), and each is recorded. A watch ends with its session, or when the pull
 * request is merged or closed.
 */
export const POLL_MS = 120_000
export const MIN_GAP_MS = 15 * 60_000
export const MAX_WAKES_A_DAY = 12

interface Watch {
  sessionId: string
  cwd: string
  number: number
  failing: Set<string>
  conflicting: boolean
  lastPoll: number
  wakes: number[]
}

export interface WatchDeps {
  enabled: () => boolean
  view: (cwd: string, number: number) => Promise<PullRequestDetail>
  /** Whether the session is still open. */
  alive: (sessionId: string) => boolean
  /** Sends the session a message, as a new turn. */
  wake: (sessionId: string, text: string) => void
  audit: Pick<HostAudit, "record">
  now?: () => number
}

const FAILED = /^(FAILURE|FAILED|ERROR|TIMED_OUT|CANCELLED|ACTION_REQUIRED)$/i

/** The checks that fail now, by name. */
export const failingChecks = (pr: PullRequestDetail): Set<string> =>
  new Set(pr.checks.filter((c) => FAILED.test(c.state)).map((c) => c.name))

export class PrWatcher {
  readonly #d: WatchDeps
  readonly #watches = new Map<string, Watch>()

  constructor(d: WatchDeps) {
    this.#d = d
  }

  #key = (sessionId: string, number: number) => `${sessionId}#${number}`

  /** Starts watching; what fails now is known, so only what fails from now on wakes the session. */
  async watch(sessionId: string, cwd: string, number: number): Promise<void> {
    const pr = await this.#d.view(cwd, number)
    this.#watches.set(this.#key(sessionId, number), {
      sessionId,
      cwd,
      number,
      failing: failingChecks(pr),
      conflicting: pr.mergeable === "CONFLICTING",
      lastPoll: this.#now(),
      wakes: [],
    })
  }

  unwatch(sessionId: string, number: number): boolean {
    return this.#watches.delete(this.#key(sessionId, number))
  }

  list(sessionId: string): number[] {
    return [...this.#watches.values()].filter((w) => w.sessionId === sessionId).map((w) => w.number)
  }

  #now = () => (this.#d.now ?? Date.now)()

  /** Called on a timer: reads each watched pull request that is due, and wakes its session when something newly broke. */
  async tick(): Promise<void> {
    if (!this.#d.enabled()) return
    for (const [key, w] of [...this.#watches]) {
      if (!this.#d.alive(w.sessionId)) {
        this.#watches.delete(key)
        continue
      }
      const now = this.#now()
      if (now - w.lastPoll < POLL_MS) continue
      w.lastPoll = now
      let pr: PullRequestDetail
      try {
        pr = await this.#d.view(w.cwd, w.number)
      } catch {
        continue
      }
      if (pr.state === "MERGED" || pr.state === "CLOSED") {
        this.#watches.delete(key)
        continue
      }
      const failing = failingChecks(pr)
      const fresh = [...failing].filter((n) => !w.failing.has(n))
      const conflict = pr.mergeable === "CONFLICTING" && !w.conflicting
      w.failing = failing
      w.conflicting = pr.mergeable === "CONFLICTING"
      if (!fresh.length && !conflict) continue
      w.wakes = w.wakes.filter((t) => now - t < 86_400_000)
      const last = w.wakes.at(-1)
      if (w.wakes.length >= MAX_WAKES_A_DAY || (last !== undefined && now - last < MIN_GAP_MS)) continue
      const said = [
        ...(fresh.length ? [`the check${fresh.length === 1 ? "" : "s"} ${fresh.map((n) => `"${n.slice(0, 80)}"`).join(", ")} now fail${fresh.length === 1 ? "s" : ""}`] : []),
        ...(conflict ? ["the branch now conflicts with its base"] : []),
      ].join(", and ")
      const recorded = await this.#d.audit.record({
        session: w.sessionId,
        event: "pr_watch_woke",
        channel: "host",
        tool: "github",
        cwd: w.cwd,
        input: { number: w.number, failing: fresh, conflict },
        verdict: {
          outcome: "allow",
          ruleId: "pr-watch",
          reason: "A pull request you asked Codehouse to watch broke, so its session was told.",
          risk: 0,
          decidedBy: "rules",
          policyHash: "",
        },
        latencyMs: 0,
      })
      if (!recorded) continue
      w.wakes.push(now)
      this.#d.wake(w.sessionId, `Pull request #${w.number}: ${said}. Look into it and fix what you can.`)
    }
  }
}

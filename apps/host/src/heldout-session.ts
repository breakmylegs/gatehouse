/**
 * D-002: running a project's held-out checks for one session. The run is recorded (sealed_check_run, the counts only),
 * the session is told the counts as an event on its screen, and the detail, with the names and the output, goes back
 * only to the desktop that asked. Used by the desktop's Run now and when a session says its build queue is empty.
 */
import type { HostAudit } from "./hostaudit.js"
import { countsLine, type HeldOutChecks, type HeldOutDetail } from "./heldout.js"

export interface HeldOutTarget {
  id: string
  cwd: string
  project: string
  emit(event: "event", e: { type: "heldout_result"; data: Record<string, unknown> }): unknown
}

export async function runHeldOutFor(
  s: HeldOutTarget,
  checks: HeldOutChecks,
  audit: Pick<HostAudit, "record">,
  why: "you" | "queue-empty",
): Promise<HeldOutDetail> {
  const detail = await checks.run(s.project, s.cwd)
  // The names and the output stay in `detail`, for the desktop; nothing below carries them.
  const counts = detail.counts
  await audit
    .record({
      session: s.id,
      event: "sealed_check_run",
      channel: why === "you" ? "desktop" : "host",
      tool: "heldout",
      cwd: s.cwd,
      project: s.project,
      input: {
        why,
        ...(counts ? { passed: counts.passed, failed: counts.failed, total: counts.total } : {}),
        ok: detail.ok,
        exitCode: detail.exitCode,
        timedOut: detail.timedOut,
        ms: detail.ms,
      },
      verdict: {
        outcome: "allow",
        ruleId: "heldout-checks",
        reason: "Codehouse ran this project's sealed held-out checks; only the counts are kept.",
        risk: 0,
        decidedBy: why === "you" ? "human-desktop" : "rules",
        policyHash: "",
      },
      latencyMs: 0,
    })
    .catch(() => undefined)
  s.emit("event", {
    type: "heldout_result",
    data: {
      line: countsLine(detail),
      ok: detail.ok,
      ...(counts ? { counts: { passed: counts.passed, failed: counts.failed, total: counts.total } } : {}),
    },
  })
  return detail
}

/**
 * E-088, the daily plan (Expansion E6). A morning plan ordered by urgency, from what Codehouse knows: a run whose
 * claims the checks Contradicted (overnight or in an open session) first, because a claimed "done" that is not is the
 * costliest thing to miss; then the decisions waiting for you, by risk; grants ending today or within three days
 * (E-078); the night shift's tasks that failed or were skipped (E-054); routine runs waiting for your review; and
 * today's routines. Each item says why it is there and where to act.
 */
export interface PlanItem {
  urgency: number
  kind: "contradicted" | "escalation" | "grant" | "night" | "review" | "routine"
  title: string
  why: string
  /** The session to open, when there is one. */
  sessionId?: string
}

export interface PlanInput {
  /** Open sessions and what their claims came to (D-009). */
  sessions: Array<{ id: string; project: string; title: string; claims: Array<{ outcome: string; quote?: string }> }>
  /** Decisions waiting for a person. */
  pending: Array<{ id: string; sessionId: string; project: string; tool: string; risk: number; reason: string }>
  /** E-078's reminders. */
  reminders: Array<{ id: string; inDays: number; text: string }>
  /** The latest night run's report, with each task's session. */
  night?: { lines: Array<{ task: string; status: string; evidence: string; sessionId?: string }> }
  /** Routine runs, newest first. */
  runs: Array<{ name: string; sessionId: string; at: string; branch?: string }>
  /** Today's routines, by name and time. */
  today: Array<{ name: string; time: string }>
  now?: Date
}

export function dailyPlan(i: PlanInput): PlanItem[] {
  const now = i.now ?? new Date()
  const items: PlanItem[] = []
  const contradictedNight = new Set<string>()
  for (const l of i.night?.lines ?? []) {
    const m = /(\d+) Contradicted/.exec(l.evidence)
    if (m && Number(m[1]) > 0) {
      if (l.sessionId) contradictedNight.add(l.sessionId)
      items.push({ urgency: 95, kind: "contradicted", title: `Overnight task ${l.task}: its claims were Contradicted`, why: `${l.evidence}. Something it said was done is not.`, ...(l.sessionId ? { sessionId: l.sessionId } : {}) })
    } else if (l.status === "failed" || l.status === "skipped" || l.status === "not run")
      items.push({ urgency: 70, kind: "night", title: `Overnight task ${l.task} ${l.status === "not run" ? "did not run" : l.status}`, why: `${l.evidence}.`, ...(l.sessionId ? { sessionId: l.sessionId } : {}) })
  }
  for (const s of i.sessions) {
    if (contradictedNight.has(s.id)) continue
    const c = s.claims.filter((x) => x.outcome === "contradicted")
    if (c.length) items.push({ urgency: 90, kind: "contradicted", title: `${s.project}: ${s.title} has ${c.length} Contradicted claim(s)`, why: c[0]!.quote ? `It said "${c[0]!.quote.slice(0, 120)}", and the checks say otherwise.` : "Its checks say otherwise.", sessionId: s.id })
  }
  for (const p of i.pending) items.push({ urgency: 40 + Math.round(p.risk / 2), kind: "escalation", title: `Waiting for you in ${p.project}: ${p.tool}, risk ${p.risk}`, why: p.reason, sessionId: p.sessionId })
  for (const r of i.reminders) items.push({ urgency: r.inDays === 0 ? 75 : 60, kind: "grant", title: "A grant is ending", why: r.text })
  const dayAgo = now.getTime() - 86_400_000
  for (const r of i.runs.filter((x) => x.branch && Date.parse(x.at) >= dayAgo)) items.push({ urgency: 50, kind: "review", title: `Review the run of ${r.name}`, why: `It ran at ${r.at.slice(11, 16)} on its own branch, ${r.branch}, and waits for you to merge or drop it.`, sessionId: r.sessionId })
  for (const r of i.today) items.push({ urgency: 20, kind: "routine", title: `${r.name} runs at ${r.time}`, why: "A routine due today." })
  return items.sort((a, b) => b.urgency - a.urgency || a.title.localeCompare(b.title))
}

import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { describePulse, type Pulse } from "./activity"

/**
 * U2: besides the requests waiting on you, the sessions that need you: one stopped by an error, a run of Extreme
 * approval that stopped short of its queue, and a turn that may be stuck. Worked out from the Host's own session
 * list each time, so it matches the Host, survives a restart, and goes as soon as the session moves on.
 */
export interface NeedsYou {
  sessionId: string
  kind: "failed" | "stopped" | "stuck"
  text: string
}

const STOPPED: Record<string, string> = {
  turns: "Extreme approval stopped at its limit on automatic turns. Send a message to carry on.",
  spend: "Extreme approval stopped at its spending limit. Send a message to carry on.",
  error: "Extreme approval stopped because a turn failed.",
  stalled: "Extreme approval stopped because two turns in a row did no work.",
}

export function needsYou(
  sessions: Record<string, SessionInfo>,
  pulse: Record<string, Pulse | undefined>,
  now: number,
): NeedsYou[] {
  const out: NeedsYou[] = []
  for (const s of Object.values(sessions)) {
    if (s.archived || s.state === "ended") continue
    if (s.state === "error") {
      out.push({
        sessionId: s.id,
        kind: "failed",
        text: s.error ? `Stopped with an error: ${s.error}` : "Stopped with an error.",
      })
      continue
    }
    const ended = s.carryOn?.ended
    if (ended && STOPPED[ended] && s.state === "idle") {
      out.push({ sessionId: s.id, kind: "stopped", text: STOPPED[ended]! })
      continue
    }
    if (s.state === "running" && s.pendingApprovals === 0 && describePulse(pulse[s.id], now).stuck)
      out.push({
        sessionId: s.id,
        kind: "stuck",
        text: "Possibly stuck: nothing from Claude for two minutes, with nothing waiting for you.",
      })
  }
  return out.sort((a, b) => a.sessionId.localeCompare(b.sessionId))
}
